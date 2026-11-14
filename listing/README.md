# Community directory listing

What the listing form in Obsidian's community directory asks for, ready to paste
and select. Submitting it needs the owner's decision and sign-in, as
[#141](https://github.com/viell-dev/slop-inkline/issues/141) describes. Under
**Edit listing** in the dashboard:

| Field             | Enter                                                       |
| ----------------- | ----------------------------------------------------------- |
| Short description | The whole of [short-description.txt](short-description.txt) |
| Long description  | The whole of [long-description.txt](long-description.txt)   |
| Categories        | Drawing, Images, Languages                                  |
| Payment type      | Free                                                        |
| Icon              | [icon.png](icon.png)                                        |
| Screenshots       | The five below, in this order                               |

The text is in plain files so that it pastes without line breaks.

| Screenshot                                 | What it shows                                                 |
| ------------------------------------------ | ------------------------------------------------------------- |
| [1-reading.png](screenshots/1-reading.png) | Symbols in a note, and the notes the library finds for one    |
| [2-suggest.png](screenshots/2-suggest.png) | Inserting a symbol by typing the insert trigger               |
| [3-drawing.png](screenshots/3-drawing.png) | Drawing on the guides of a line of text                       |
| [4-tracing.png](screenshots/4-tracing.png) | Turning a pasted picture into ink                             |
| [5-text.png](screenshots/5-text.png)       | Symbols following the size and color of headings and callouts |

Everything shown is synthetic: invented signs in invented notes.

## What these follow

Obsidian's public documents give these limits, and `test/unit/listing.test.ts`
checks them:

- Up to five desktop screenshots of 1200 by 800 pixels, as JPEG, PNG, or WebP of
  up to 5 MB each, as
  [its guide](https://github.com/obsidianmd/obsidian-developer-docs/blob/1c26772ac13d6e9870c865936d389fdfe694e742/en/Community%20directory/Manage%20your%20plugin%20or%20theme.md#update-your-listing)
  says. Mobile screenshots are left out, as Inkline is desktop only.
- A description of at most 250 characters that ends with a period, with no
  emoji, as the
  [submission requirements](https://github.com/obsidianmd/obsidian-developer-docs/blob/1c26772ac13d6e9870c865936d389fdfe694e742/en/Community%20directory/Submission%20requirements%20for%20plugins.md#keep-plugin-descriptions-short-and-simple)
  say. The short description is the manifest's own.

The form is behind a sign-in, so three things here are informed guesses, and the
form has the last word:

- **The icon's size.** No public document gives one, so this is a 512 pixel
  square, with transparent corners. `iconSide` in the spec below changes it.
- **The long description's length.** No limit is published.
- **The number of categories.** The ones here are from the 78 the directory's
  site lists. Every comparable listing checked shows three, so the form may stop
  at three.

## Make the pictures again

The screenshots show the plugin as it was built, so make them again from the
release being listed:

```sh
OBSIDIAN_VERSIONS=latest/latest npm run test:e2e:docker -- \
  --spec test/e2e/manual/listing.e2e.ts
```

`test/e2e/manual/listing.e2e.ts` builds the signs and notes, fixes the page at
1200 by 800 pixels, and fails if a screenshot comes out another size. It writes
`listing-*.png` under `test-results/e2e/screenshots/<versions>/`, to copy here
into `screenshots/` without the `listing-` prefix, and the icon, rendered from
[icon.svg](icon.svg), as `test-results/e2e/screenshots/listing-icon.png`, to
copy here as `icon.png`.
