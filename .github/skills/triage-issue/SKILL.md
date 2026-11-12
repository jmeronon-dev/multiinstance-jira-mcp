---
name: triage-issue
description: "Triage a new software factory Issue: choose the status (✅ agent-ready, 📐 needs-spec or 💬 needs-info), lights, complexity and area, and leave one short comment. USE FOR: newly opened Issues that have not been triaged. DO NOT USE FOR: writing code, assigning, closing or editing Issues, or inventing labels."
---

# Triage an Issue

> Rules and examples: [rules](references/rules.md) (edited by 🔁 Triage learn, always through a reviewed PR).

## Steps

1. If the Issue already has ✅ agent-ready, 📐 needs-spec or 💬 needs-info, it is already triaged: do nothing.
2. Read the Issue and the [rules](references/rules.md); if an example looks similar, follow it.
3. Choose ONE status label:
   - ✅ agent-ready: it is clear what to do and it can be verified when done.
   - 📐 needs-spec: it must be designed first (new behaviour, several areas, open questions).
   - 💬 needs-info: missing reproduction data, endpoints, a mandatory confirmation, or what fails.
4. Only for ✅ agent-ready, choose the lights: 💡 lights-on if it changes the behaviour of the server; 🌙 lights-out if it only touches documentation.
5. Add ONE complexity: 🟢 complexity-low, 🟡 complexity-medium or 🔴 complexity-high.
6. Add at most ONE area (🔐 auth, 🧭 routing, 🧩 tools, 🔌 jira-api, ⚙️ config, 📝 documentation or 🚀 ci-release) following the rules; none if nothing fits clearly or a person already set one.
7. Remove 🔍 needs-triage if present and add the chosen labels.
8. Leave a single short comment with this format:

   ```text
   **🏷️ Triage:** <labels>
   **Why:** <one or two sentences>
   **Next step:** <what is missing or who goes next>
   ```

## Limits

Never write code, assign, close or edit the Issue, or use labels outside this list. When in doubt, choose the most cautious option (📐 needs-spec or 💬 needs-info) and explain it.
