---
name: Bug report
about: Create a report to help us improve
title: ''
labels: bug
assignees: ''

---

<!-- Please support your supporters: Avoid screen shots and use markdown as much as possible

Avoid code screen shots from your IDE where ever possible, instead use [code markdown](https://github.com/adam-p/markdown-here/wiki/Markdown-Cheatsheet#code) and syntax highlighting: `cds`, `sql`, `diff`.

- Bitmap images are hard to read due to different color schemes and screen resolutions.
  Usually they need to be opened in a different browser tab, enlarged etc.
  Especially when working on multiple issues in parallel, it's easy to loose sight.
- Code/Messages can't be copied/pasted into own editors, test files etc.
-->


### Description of erroneous behaviour

> Please test with the **latest release version** of the CAP runtime (see links below).
Replace this text with a **clear** and **concise** description of the issue, including examples and links to your content as well as log output.
For example...

> We have a [query](https://github.com/capire/bookshop/blob/b63c7026912924b1e3b80550f1f5545efc22d93b/srv/admin-service.js#L12) defined as follows:

```js
 await SELECT.one.from(req.target).columns('max(ID) as ID')
```

> When deploying to sqlite we get the following errors:

```sh
... copy of log output ...
```

### Detailed steps to reproduce

> For example (→ replace by appropriate ones for your case):
> 1. git clone https://github.com/your/repo
> 2. npm install
> 3. cds deploy srv -2 sqlite

### Details about your project

> Remove the lines not applicable, and fill in versions for remaining ones:

| Your Project Name | https://github.com/your/repo |
|:------------------|---------------------------------------|
| OData version     | v4 / v2                               |
| Node.js version   | v18.x.x                               |
| @sap/cds          | 6.x.x                                 |
| @sap/cds-compiler | 3.x.x                                 |
| @sap/cds-dk       | 6.x.x                                 |
| @cap-js/postgres | 1.x.x |
@cap-js/sqlite | 1.x.x |

> Run `cds v -i` in your project root to generate this
