---
name: example-skill
description: Demonstrates Pacvue internal skill layout and authoring conventions. Use when learning how to write skills for this repository or when validating that npx skills add can install from Pacvue/skills.
disable-model-invocation: true
metadata:
  author: pacvue
  version: "0.1.0"
---

# Example Skill

This skill is a **reference only**. It shows the minimum structure expected in `Pacvue/skills`.

## When to use

- You are authoring a new Pacvue skill and want a concrete pattern to copy.
- You are testing installation: `npx skills add Pacvue/skills --skill example-skill -a cursor`.

## Workflow

1. Read the user's request.
2. Reply with a one-line summary of what you would do (do not run real side effects).
3. Point the author to [examples.md](examples.md) for input/output samples.

## Conventions in this repo

- Folder name must match `name` in frontmatter (lowercase, hyphens).
- Keep `SKILL.md` focused; move long references to sibling files.
- Write `description` in third person with clear trigger terms (WHAT + WHEN).

## More examples

See [examples.md](examples.md).
