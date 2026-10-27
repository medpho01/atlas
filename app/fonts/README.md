# Inter, self-hosted

`next/font/google` downloads the font **at build time**. That turns every
production build into a request to `fonts.googleapis.com`, and on 2026-10-27 a
deploy failed outright because the host could not reach it:

```
NextFontError: Failed to fetch `Inter` from Google Fonts.  ETIMEDOUT
```

Nothing about the build needs the internet except this, so the font is checked
in and loaded with `next/font/local`. Builds now work on a host with no
outbound access, and the rendered output is the same: the same variable file
Google would have served, self-hosted, with the same `--font-inter` variable
and `display: swap`.

`inter-latin.woff2` is the variable face covering weights 100–900, latin
subset only — which is what `subsets: ['latin']` fetched before. 48 KB.

Inter is licensed under the SIL Open Font License 1.1; `Inter-LICENSE.txt` is
included as the licence requires.

To update it, take the URL from the `/* latin */` block of
`https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap`
(request it with a browser user-agent, or Google serves TTF instead of woff2).
