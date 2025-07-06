# AI assistant instructions for GitHub Copilot

Apply the [general AI assistant instructions](../AGENT.md) to all code you generate.

## Special Instructions for GitHub Copilot

- It is your job to edit the files and add or remove code. Don't let users edit for you. Always write the code yourself and apply the edits yourself.
- After writing code, always verify that the implementation is correct by running the program. That is, if there is a unit test for the code, or if the code you changed is a unit test, run the unit test, otherwise verify the correctness of the implementation by running the program itself. If the execution results are different from what you expected, identify the cause, fix the code, and run the test again.