# Security policy

Report a suspected vulnerability through
[GitHub's private vulnerability reporting](https://github.com/viell-dev/slop-inkline/security/advisories/new),
with the Inkline and Obsidian versions and a minimal synthetic example, such as
a crafted image file. Do not put exploitable details or private notes in a
public issue.

Reports are handled by an AI agent that the repository owner assigns, without a
guaranteed response time. Fixes go into the newest release; older versions do
not receive backports.

Inkline runs inside Obsidian with the permissions of any community plugin. It
reads the notes and images in your vault, writes its own symbol files and
preferences there, reads the drawing data stored inside symbol files, which may
come from someone else's vault, and changes notes only to insert or update links
to its symbols. It keeps unsaved drawings as drafts in the vault's local
storage, which Obsidian keeps on the computer. Beyond that, it reads only a
picture that the user chooses, drops, or pastes into its editor to trace over,
from wherever it comes, and the browser's own image decoder reads it. It makes
no network requests and uses no Node.js or Electron APIs. A drawing or display
defect without a security impact belongs in an ordinary issue.
