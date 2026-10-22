#!/bin/sh
# human-photo.sh --- Add a photo to the "Certified I am a human" page.
#
# Usage (from anywhere):
#   build/human-photo.sh ~/Pictures/"pics of me"/IMG_1234.heic some-name
#
# Writes img/human/<some-name>.jpg: turned upright, converted to sRGB, at most
# 1200px on its long edge, with all metadata (GPS location included) stripped.
# Then prints an Org snippet to paste into org/i-am-human.org.

set -eu

if [ $# -ne 2 ]; then
    echo "usage: $0 SOURCE-IMAGE NAME" >&2
    exit 1
fi

src=$1
name=$2
root=$(cd "$(dirname "$0")/.." && pwd)
rel="img/human/$name.jpg"

mkdir -p "$root/img/human"
magick "$src" -auto-orient \
       -profile "/System/Library/ColorSync/Profiles/sRGB Profile.icc" \
       -resize '1200x1200>' -strip -interlace Plane -quality 80 \
       "$root/$rel"

dims=$(magick identify -format '%w %h' "$root/$rel")
w=${dims% *}
h=${dims#* }

cat <<EOF
#+CAPTION: Your caption here.
#+ATTR_HTML: :alt Describe the photo for screen readers :width $w :height $h :loading lazy
[[file:$rel]]
EOF
