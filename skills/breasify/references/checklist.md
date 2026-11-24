# What Brease checks

When the repository is connected, setup's **Final checks** step looks at the production branch. A site counts as
ready for Brease when:

1. **brease-client is a dependency** in the site's `package.json` (in the root folder Brease was told about).
2. **`BREASE.md` exists** next to that `package.json`.
3. **The content is there**: `brease-seed/` (or a committed `.brease/`) with valid JSON in the layout from
   [seed.md](seed.md), every `$file` pointing at a file in the repository. Final checks imports it.
4. **The site builds and runs** with Brease's token: Brease starts it in its editor and checks that pages answer.
5. **Pages read from Brease**: the preview shows the imported content, and edited elements carry `data-brease`
   markers.

`npx brease-client check` runs the parts of this that can be checked locally (1, 2, 3 and the sections setup). Run
it before handing over.

Things that make Final checks fail most often:

- `brease-client` added to a sub-package's `package.json` but setup pointed at another folder.
- The token hard-coded or read in browser code (the site then works locally but not on the host).
- A `$file` path written relative to `brease-seed/` instead of the site's root.
- Language files for a language the site doesn't have in Brease.
- Old routes left next to the new catch-all route, so two routes answer the same URL.
