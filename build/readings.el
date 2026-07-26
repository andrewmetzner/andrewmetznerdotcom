;;; readings.el --- Build the readings page, feed, and homepage panel -*- lexical-binding: t; -*-
;;
;; Reads the readings from org/readings.org (one headline per book, with the
;; review as Org-formatted body text) and writes three files to the repo root:
;;
;;   readings.html          the readings page
;;   readings.xml           the RSS feed
;;   recent-readings.html   a small fragment the homepage #+INCLUDEs
;;
;; To add or edit a book, edit org/readings.org and rebuild:
;;
;;   emacs --batch -l build/readings.el      (or build/build.el for the whole site)

(require 'org)
(require 'ox-html)
(require 'ox-ascii)
(require 'cl-lib)

(defvar amz-root
  (expand-file-name ".." (file-name-directory (or load-file-name buffer-file-name default-directory))))

(defvar amz-readings-org (expand-file-name "org/readings.org" amz-root))
(defvar amz-site "https://andrewmetzner.com")
(defvar amz-recent-count 3 "surface on homepage amt")

(defun amz-entry-body ()
  (save-excursion
    (org-back-to-heading t)
    (org-end-of-meta-data t)
    (let ((beg (point))
          (end (save-excursion (org-back-to-heading t) (org-end-of-subtree t t) (point))))
      (string-trim (buffer-substring-no-properties beg end)))))

(defun amz-org->html (s)
  (if (string-empty-p (string-trim s)) ""
    (string-trim (org-export-string-as s 'html t))))

(defun amz-org->text (s)
  (if (string-empty-p (string-trim s)) ""
    (let ((org-ascii-text-width 100000)
          (org-ascii-links-to-notes nil))
      (string-trim (org-export-string-as s 'ascii t)))))

(defun amz-round-half (n)
  "Round N to the nearest 0.5."
  (/ (fround (* n 2)) 2.0))

(defun amz-load-readings ()
  (let (raw)
    (with-temp-buffer
      (insert-file-contents amz-readings-org)
      (let ((org-inhibit-startup t)) (org-mode))
      (org-map-entries
       (lambda ()
         (push (list :date   (or (org-entry-get nil "DATE") "")
                     :author (or (org-entry-get nil "AUTHOR") "")
                     :title  (org-get-heading t t t t)
                     :stars  (amz-round-half (string-to-number (or (org-entry-get nil "STARS") "0")))
                     :body   (amz-entry-body))
               raw))
       nil nil))

    (mapcar (lambda (e)
              (list :date   (plist-get e :date)
                    :author (plist-get e :author)
                    :title  (plist-get e :title)
                    :stars  (plist-get e :stars)
                    :html   (amz-org->html (plist-get e :body))
                    :text   (amz-org->text (plist-get e :body))))
            (nreverse raw))))

;;; Helpers

(defun amz-esc (s)
  "Escape &, <, > in S for HTML/XML text content."
  (setq s (replace-regexp-in-string "&" "&amp;" s t t))
  (setq s (replace-regexp-in-string "<" "&lt;" s t t))
  (replace-regexp-in-string ">" "&gt;" s t t))

(defun amz-slug (s)
  "Lowercase kebab-case slug of S."
  (string-trim (replace-regexp-in-string "[^a-z0-9]+" "-" (downcase s)) "-+" "-+"))

(defun amz-parse-time (date)
  "Parse DATE (ISO 8601 date or date-time) into an Emacs time, or nil if blank.
Accepts \"2026-07-10\" or \"2026-07-10T02:09:38-04:00\"."
  (let ((d (string-trim (or date ""))))
    (cond ((string-empty-p d) nil)
          ((string-match-p "T" d) (date-to-time d))
          (t (date-to-time (concat d "T00:00:00Z"))))))

(defun amz-date-part (date)
  "The calendar-date portion (YYYY-MM-DD) of DATE, without any time."
  (car (split-string (string-trim (or date "")) "T")))

(defun amz-time-part (date)
  "The HH:MM portion of DATE when it includes a time, else nil."
  (let ((d (string-trim (or date ""))))
    (when (string-match "T\\([0-9][0-9]:[0-9][0-9]\\)" d)
      (match-string 1 d))))

(defun amz-rfc822 (date)
  "Convert DATE (ISO 8601 date or date-time) to an RFC 822 string in GMT.
Falls back to the current time when DATE is missing or blank."
  (format-time-string "%a, %d %b %Y %H:%M:%S GMT"
                      (or (amz-parse-time date) (current-time)) t))

(defun amz-out (name)
  (expand-file-name name amz-root))

(defun amz-file-hash (path)
  "Short content hash of PATH, or nil when the file does not exist."
  (when (file-exists-p path)
    (substring (secure-hash 'md5 (with-temp-buffer
                                   (insert-file-contents-literally path)
                                   (buffer-string)))
               0 8)))

(defun amz-stamp-assets (html-file)
  "Append a content-hash ?v= query to the CSS and favicon references in
HTML-FILE so browsers and home-screen apps refetch them the moment the files
change (and keep their cache while the files are unchanged)."
  (let ((assets (list (cons "Dreamsongs.css"       (amz-file-hash (amz-out "Dreamsongs.css")))
                      (cons "favicon.png"          (amz-file-hash (amz-out "favicon.png")))
                      (cons "favicon.ico"          (amz-file-hash (amz-out "favicon.ico")))
                      (cons "apple-touch-icon.png" (amz-file-hash (amz-out "apple-touch-icon.png"))))))
    (with-temp-buffer
      (insert-file-contents html-file)
      (dolist (a assets)
        (when (cdr a)
          (goto-char (point-min))
          (while (search-forward (format "\"%s\"" (car a)) nil t)
            (replace-match (format "\"%s?v=%s\"" (car a) (cdr a)) t t))))
      (write-region (point-min) (point-max) html-file nil 'silent))))

;;; Star ratings (svg, half-star capable)

(defvar amz-star-offsets
  ;; (dx . dy) points of a single 5-point star, relative to its center,
  ;; matching the geometry of the original hand-drawn img/stars-blue-*.svg.
  '((0.00 . 0.80) (1.94 . 6.33) (7.80 . 6.47) (3.14 . 10.02) (4.82 . 15.63)
    (0.00 . 12.30) (-4.82 . 15.63) (-3.14 . 10.02) (-7.80 . 6.47) (-1.94 . 6.33)))

(defvar amz-star-centers '(9 27 45 63 81))

(defvar amz-star-files-written (make-hash-table :test 'equal)
  "Ratings (as their filename slug) already flushed to img/ this run.")

(defun amz-format-rating (rating)
  "RATING as \"3\" or \"3.5\" for display and filenames."
  (if (= rating (truncate rating))
      (number-to-string (truncate rating))
    (format "%.1f" rating)))

(defun amz-star-points (cx)
  (mapconcat (lambda (p) (format "%.2f,%.2f" (+ cx (car p)) (cdr p)))
             amz-star-offsets " "))

(defun amz-star-polygon (cx fill stroke)
  (format "<polygon points=\"%s\" fill=\"%s\" stroke=\"%s\" stroke-width=\"0.8\" stroke-linejoin=\"round\"/>"
          (amz-star-points cx) fill stroke))

(defun amz-star-half (cx idx)
  "A half-filled star at CX: empty star behind, filled star clipped to its left half."
  (let ((clip-id (format "star-clip-%d" idx)))
    (format "<defs><clipPath id=\"%s\"><rect x=\"%.2f\" y=\"0\" width=\"7.8\" height=\"18\"/></clipPath></defs>\n  %s\n  <g clip-path=\"url(#%s)\">%s</g>"
            clip-id (- cx 7.8)
            (amz-star-polygon cx "#e7ded3" "#9aa7b0")
            clip-id
            (amz-star-polygon cx "#1f5f8b" "#1f5f8b"))))

(defun amz-stars-svg (rating)
  "Build the stars-row svg markup for RATING (0-5, half-steps allowed)."
  (let* ((full (floor rating))
         (has-half (>= (- rating full) 0.5))
         (idx 0)
         (body (mapconcat
                (lambda (cx)
                  (setq idx (1+ idx))
                  (cond ((<= idx full) (amz-star-polygon cx "#1f5f8b" "#1f5f8b"))
                        ((and has-half (= idx (1+ full))) (amz-star-half cx idx))
                        (t (amz-star-polygon cx "#e7ded3" "#9aa7b0"))))
                amz-star-centers "\n  ")))
    (format "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 90 18\" width=\"90\" height=\"18\" role=\"img\" aria-label=\"%s out of 5 stars\">\n  %s\n</svg>\n"
            (amz-format-rating rating) body)))

(defun amz-star-src (rating)
  "Ensure img/stars-blue-<rating>.svg exists for RATING and return its filename."
  (let* ((slug (amz-format-rating rating))
         (fname (format "stars-blue-%s.svg" slug)))
    (unless (gethash slug amz-star-files-written)
      (let ((path (amz-out (concat "img/" fname))))
        (make-directory (file-name-directory path) t)
        (with-temp-file path (insert (amz-stars-svg rating))))
      (puthash slug t amz-star-files-written))
    fname))

;;; Reading

(defun amz-reading-html (e)
  "Render reading entry E as an <article> block."
  (let* ((raw (plist-get e :date))
         (tm (amz-time-part raw))
         (time-html (if tm (format "<span class=\"reading-time\">%s</span>" tm) "")))
    (format "  <article class=\"reading\">
    <div class=\"reading-row\">
      <span class=\"reading-date\"><time datetime=\"%s\">%s%s</time></span>
      <span class=\"reading-title\">%s, <cite>%s</cite></span>
      <span class=\"reading-rating\"><img class=\"stars\" src=\"img/%s\" width=\"90\" height=\"18\" alt=\"%s out of 5 stars\" /></span>
    </div>
    <div class=\"reading-review\">%s</div>
  </article>"
            raw (amz-date-part raw) time-html
            (amz-esc (plist-get e :author)) (amz-esc (plist-get e :title))
            (amz-star-src (plist-get e :stars)) (amz-format-rating (plist-get e :stars))
            (plist-get e :html))))

(defun amz-build-html (readings)
  (let ((body (if readings
                  (concat "  <div class=\"readings-head\" aria-hidden=\"true\">\n"
                          "    <span class=\"col-date\">Date</span>\n"
                          "    <span class=\"col-title\">Author / Title</span>\n"
                          "    <span class=\"col-rating\">Rating</span>\n"
                          "  </div>\n\n"
                          (mapconcat #'amz-reading-html readings "\n\n"))
                "  <p class=\"readings-empty\">n/a, none available right now</p>")))
    (with-temp-file (amz-out "readings.html")
      (insert (format "<!DOCTYPE html>
<html lang=\"en\">
<head>
<meta charset=\"utf-8\" />
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
<title>Readings</title>
<meta name=\"author\" content=\"Andrew Metzner\" />
<meta name=\"description\" content=\"Books Andrew Metzner has read, with ratings and short takes.\" />
<link rel=\"alternate\" type=\"application/rss+xml\" title=\"Andrew Metzner: Readings\" href=\"%s/readings.xml\" />
<meta property=\"og:title\" content=\"Recent books I've read; Andrew Metzner\" />
<meta property=\"og:description\" content=\"Books I've read, rated, and reviewed.\" />
<meta property=\"og:image\" content=\"%s/img/og-nullpo.png\" />
<meta property=\"og:url\" content=\"%s/readings.html\" />
<meta property=\"og:type\" content=\"website\" />
<meta name=\"twitter:card\" content=\"summary_large_image\" />
<meta name=\"twitter:image\" content=\"%s/img/og-nullpo.png\" />
<link rel=\"stylesheet\" type=\"text/css\" href=\"Dreamsongs.css\" />
<link rel=\"icon\" type=\"image/png\" href=\"favicon.png\" />
<link rel=\"icon\" type=\"image/x-icon\" href=\"favicon.ico\" />
<link rel=\"apple-touch-icon\" href=\"apple-touch-icon.png\" />
</head>
<body>
<p>[ <a href=\"index.html\">go home</a> // <a href=\"readings.xml\">rss GET</a> ]</p>
<div class=\"readings\">
%s
</div>
</body>
</html>
"
                      amz-site amz-site amz-site amz-site body)))
    ;; Push version strings into readings.html right after creating it
    (amz-stamp-assets (amz-out "readings.html"))
    (message "Wrote readings.html (%d entries)" (length readings))))

;;; RSS feed

(defun amz-reading-rss (e)
  (format "    <item>
      <title>%s, \"%s\" (%s/5)</title>
      <link>%s/readings.html</link>
      <guid isPermaLink=\"false\">andrewmetzner.com/readings/%s</guid>
      <pubDate>%s</pubDate>
      <description>%s</description>
    </item>"
          (amz-esc (plist-get e :author)) (amz-esc (plist-get e :title))
          (amz-format-rating (plist-get e :stars))
          amz-site
          (amz-slug (concat (plist-get e :author) "-" (plist-get e :title)))
          (amz-rfc822 (plist-get e :date))
          (amz-esc (plist-get e :text))))

(defun amz-build-rss (readings)
  (let* ((items (mapconcat #'amz-reading-rss readings "\n\n"))
         (built (amz-rfc822 (plist-get (car readings) :date)))
         (favicon-hash (amz-file-hash (amz-out "favicon.png")))
         (favicon-url (if favicon-hash
                           (format "%s/favicon.png?v=%s" amz-site favicon-hash)
                         (format "%s/favicon.png" amz-site))))
    (with-temp-file (amz-out "readings.xml")
      (insert (format "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\" xmlns:webfeeds=\"http://webfeeds.org/rss/1.0\">
  <channel>
    <title>Andrew Metzner: Readings</title>
    <link>%s/readings.html</link>
    <atom:link href=\"%s/readings.xml\" rel=\"self\" type=\"application/rss+xml\" />
    <description>Books I've read, rated, and reviewed.</description>
    <language>en-us</language>
    <!-- webfeeds:icon wins over <image> and over anything a reader scrapes
         from the home page, so readers never fall back to the og: image. -->
    <webfeeds:icon>%s</webfeeds:icon>
    <image>
      <url>%s</url>
      <title>Andrew Metzner: Readings</title>
      <link>%s/readings.html</link>
      <width>32</width>
      <height>32</height>
    </image>
    <lastBuildDate>%s</lastBuildDate>

%s
  </channel>
</rss>
"
                      amz-site amz-site favicon-url favicon-url amz-site built items)))
    (message "Wrote readings.xml")))

;;; fragment on home

(defun amz-recent-item (e)
  (format "  <li><span class=\"recent-date\">%s</span> %s, <cite>%s</cite> <img class=\"stars stars-sm\" src=\"img/%s\" width=\"72\" height=\"14\" alt=\"%s out of 5 stars\" /></li>"
          (amz-date-part (plist-get e :date))
          (amz-esc (plist-get e :author)) (amz-esc (plist-get e :title))
          (amz-star-src (plist-get e :stars)) (amz-format-rating (plist-get e :stars))))

(defun amz-build-recent (readings)
  (let* ((recent (cl-subseq readings 0 (min amz-recent-count (length readings))))
         ;; Anchor to the repo root so it doesn't depend on Emacs's CWD.
         (output-path (expand-file-name "part/recent-readings.html" amz-root))
         (html (if recent
                   (format "<ul class=\"recent-list\">\n%s\n</ul>\n<p class=\"recent-more\"><a href=\"readings.html\">view more</a></p>\n"
                           (mapconcat #'amz-recent-item recent "\n"))
                 "<p class=\"recent-empty\">n/a, none available right now</p>\n")))
    (make-directory (file-name-directory output-path) t)
    (with-temp-file output-path
      (insert html))
    (message "Wrote %s" output-path)))

;;; run

(let ((readings (amz-load-readings)))
  (amz-build-html readings)
  (amz-build-rss readings)
  (amz-build-recent readings))

;;; readings.el ends here
