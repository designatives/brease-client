# brease-seed/: the site's first content

`brease-seed/` in the site's root holds the content Brease imports once, in setup's **Final checks** step. After the
import the content lives in Brease; the folder can then be removed (setup offers that).

```
brease-seed/
  manifest.json                 { "schemaVersion": 1 }
  site.json                     { "name", "seo": { "<locale>": { titleTemplate, siteName, description, … } } }
  pages/<pageId>/page.json      { "name", "parentId", "order" }
  pages/<pageId>/<locale>.json  { "slug", "hidden", "seo", "content" }   one file per language
  navigations/<key>.json        { "items": [{ "id", "label": { "<locale>": "…" }, "pageId" | "href", "children"? }] }
  redirects.json                [{ "source", "destination", "status" }]
```

- **Page ids**: `pg_` plus a short readable name (`pg_home`, `pg_about`, `pg_global`). Ids stay the same in every
  language. The home page's slug is `""`; the site-wide page is `pg_global` with slug `_global`.
- **Languages**: one `<locale>.json` per language a page exists in. A page left out of a language on purpose has no
  file for it. Every language used must be one of the site's languages in Brease.
- **content**: the shape your templates read. With `content.template` when the site has more than one template.
  Sections: `"sections": [{ "id": "sec_…", "type": "<folder name>", …fields }]`, same ids, order and types in every
  language of a page.
- **Links**: `{ "label", "href" }`; a link to a page of the site adds `"pageId"` so its URL follows each language.
- **Rich text**: an HTML string.
- **Images and documents**: point at the file in the repository:

  ```json
  { "$file": "public/images/hero.jpg", "alt": "Two guests on the terrace at sunset" }
  ```

  The path is relative to the site's root. Brease uploads the file to the site's media library during the import
  and stores the image's address, size and alt text in its place. The same file referenced twice is uploaded once.
  Give alt text in the page's language; left out, Brease writes it. A path that doesn't exist is reported in the
  import, not silently dropped. Don't move or delete the original files: the site may still use them.

Docs: [content model](https://docs.brease.io/docs/developers/content-model),
[content schema](https://docs.brease.io/docs/developers/content-schema),
[sections](https://docs.brease.io/docs/developers/sections).
