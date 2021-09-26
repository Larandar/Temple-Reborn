---
{%- set journalDate = file.basename | parseDate('yyyy-MM-dd') %}
date created: "{{ file.stat.ctime | formatDate }}"
date updated: "{{ file.stat.mtime | formatDate }}"
journal date: "{{ journalDate | formatDate('yyyy-MM-dd') }}"
tags: [📅/🌞]

---

# Journal of [[{{ file.basename }}]]

[[{{ journalDate  | formatDate("yyyy-'W'WW") }}]] << [[{{ journalDate.minus({days: 1}) | formatDate("yyyy-MM-dd")  }}]] | [[{{ journalDate.plus({days: 1}) | formatDate("yyyy-MM-dd") }}]] >>

## TODOS

- [ ] [Check Habitica for the day](https://habitica.com/)
- [ ] Set my [[{{ file.basename }}#Big 3]]

### Big 3

- [ ] (1)
- [ ] (2)
- [ ] (3)
