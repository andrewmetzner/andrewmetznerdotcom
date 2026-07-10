;;; build.el --- Build andrewmetzner.com -*- lexical-binding: t; -*-
;;
;; Usage (from anywhere):
;;   emacs --batch -l build/build.el
;;
;; Builds the readings page + feed + homepage fragment (via readings.el), then
;; exports each Org page in `amz-pages' from org/ to a .html file at the repo
;; root. Org sources live in org/; build scripts live in build/.

(require 'org)
(require 'ox-html)

(setq make-backup-files nil
      org-export-with-toc nil
      org-export-with-section-numbers nil
      org-html-validation-link nil
      org-html-htmlize-output-type 'css
      org-html-postamble t
      org-html-postamble-format
      '(("en" "<p class=\"postamble\">Last modified: %C<br />%c</p>")))

(defvar amz-pages '("index.org"))

(let* ((here (file-name-directory (or load-file-name buffer-file-name default-directory)))
       (root (expand-file-name ".." here))
       (org-dir (expand-file-name "org" root)))
  (load (expand-file-name "readings.el" here))
  (dolist (page amz-pages)
    (let ((src (expand-file-name page org-dir))
          (out (expand-file-name (concat (file-name-base page) ".html") root))
          (default-directory org-dir))
      (with-current-buffer (find-file-noselect src)
        (message "Exporting %s -> %s" page out)
        (org-export-to-file 'html out)
        (kill-buffer))))
  (message "Build complete."))

;;; build.el ends here
