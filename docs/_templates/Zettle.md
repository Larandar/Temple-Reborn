---
uid: "{{ zettel.uid }}"
date created: "{{ file.stat.ctime | formatDate }}"
date updated: "{{ file.stat.mtime | formatDate }}"
aliases: ["{{ zettel.title }}"]
tags: [📝️/🌱️]

---

# [[{{ file.basename }}|{{ zettel.title }}]]
