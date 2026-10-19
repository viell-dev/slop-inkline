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
reads and writes image files in your vault, reads the drawing data stored inside
them, which may come from someone else's vault, and changes notes only to insert
or update links to those images. It makes no network requests and uses no
Node.js or Electron APIs. A drawing or display defect without a security impact
belongs in an ordinary issue.
