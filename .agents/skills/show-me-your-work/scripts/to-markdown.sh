#!/usr/bin/env bash
# Convert a show-me-your-work TSV decision log to a Markdown table.
# Usage: to-markdown.sh <logfile.tsv> <output.md>
set -euo pipefail

if [ "$#" -ne 2 ]; then
	printf 'usage: to-markdown.sh <logfile.tsv> <output.md>\n' >&2
	exit 1
fi

logfile="$1"
output="$2"

if [ ! -f "$logfile" ]; then
	printf 'error: decision log does not exist: %s\n' "$logfile" >&2
	exit 1
fi

if [ "$logfile" = "$output" ]; then
	printf 'error: input and output must be different files\n' >&2
	exit 1
fi

output_dir="$(dirname "$output")"
if [ ! -d "$output_dir" ]; then
	mkdir -p "$output_dir"
fi

tmpfile="$(mktemp "${output}.tmp.XXXXXX")"
trap 'rm -f "$tmpfile"' EXIT

LC_ALL=C awk -F '\t' '
	function markdown_cell(value, escaped, i, char) {
		escaped = ""
		for (i = 1; i <= length(value); i++) {
			char = substr(value, i, 1)
			if (char == "\\" || char == "|") {
				escaped = escaped "\\"
			}
			escaped = escaped char
		}
		return escaped
	}

	BEGIN {
		expected_header = "ts\tphase\tdecision\twhy\tevidence\tresult"
		expected_columns = 6
	}

	NR == 1 {
		if ($0 != expected_header) {
			print "error: unexpected decision-log header" > "/dev/stderr"
			exit 2
		}
	}

	NF != expected_columns {
		printf "error: row %d has %d columns; expected %d\n", NR, NF, expected_columns > "/dev/stderr"
		exit 2
	}

	{
		printf "|"
		for (i = 1; i <= NF; i++) {
			printf " %s |", markdown_cell($i)
		}
		printf "\n"

		if (NR == 1) {
			printf "|"
			for (i = 1; i <= NF; i++) {
				printf " --- |"
			}
			printf "\n"
		}
	}

	END {
		if (NR == 0) {
			print "error: decision log is empty" > "/dev/stderr"
			exit 2
		}
	}
' "$logfile" > "$tmpfile"

mv "$tmpfile" "$output"
trap - EXIT
