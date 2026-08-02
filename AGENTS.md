# Instructions for AI Coding Agents

## Stage Completion Updates

After completing each major stage or substantial step, report a compact git message describing the completed work. Use a Conventional Commit-style prefix, for example:

```text
feat: add scenario result filtering
fix: preserve oauth state during callback
docs: clarify local development setup
test: cover invalid evaluation configs
refactor: extract shared route validation
```

Keep the message short and specific. This is a status update only; do not create a commit automatically.

## Commits

The user typically commits changes manually after a completed stage or major step. Do not run `git commit` unless the user explicitly asks you to commit. When a stage is complete, show the suggested compact git message and leave the working tree ready for the user to review and commit.
