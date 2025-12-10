# Contributing

## Engaging in Our Project

We use GitHub to manage reviews of pull requests.

* If you are a new contributor, see: [Steps to Contribute](#steps-to-contribute)

* Before implementing your change, create an issue that describes the problem you would like to solve or the code that should be enhanced. Please note that you are willing to work on that issue.

* The team will review the issue and decide whether it should be implemented as a pull request. In that case, they will assign the issue to you. If the team decides against picking up the issue, the team will post a comment with an explanation.

## Steps to Contribute

Should you wish to work on an issue, please claim it first by commenting on the GitHub issue that you want to work on. This is to prevent duplicated efforts from other contributors on the same issue.

If you have questions about one of the issues, please comment on them, and one of the maintainers will clarify.

## Issues and Planning

* We use GitHub issues to track bugs and enhancement requests.

* Please provide as much context as possible when you open an issue. The information you provide must be comprehensive enough to reproduce that issue for the assignee.

## Committing

Our commit messages use a simplified form of [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/). This is how our automated release system knows what a given commit means.

```md
<type>: <description>

[body]
```

### Commit type prefixes

The `type` can be any of `feat`, `fix` or `chore`.

The prefix is used to calculate the semver release level, and the section of the release notes to place the commit message in.

| **type**   | When to Use                          | Release Level | Release Note Section  |
| ---------- | ----------------------------------- | ------------- | --------------------   |
| feat       | A feature has been added            | `minor`       | **Added**           |
| changed     | Changes to the dependencies     | `minor`       | **Changed**          |
| fix        | A bug has been patched              | `patch`       | **Fixed**          |
| deps        | Changes to the dependencies        | `patch`       | **Changed**          |
| perf       | Performance improvements            | none          | **Performance Improvements**   |
| chore      | Any changes that aren't user-facing | none          | none                   |
| docs       | Documentation updates               | none          | none                   |
| style      | Code style and formatting changes   | none          | none                   |
| refactor   | Code refactoring                    | none          | none                   |
| test       | Adding tests or test-related changes| none          | none                   |
| build      | Build system or tooling changes     | none          | none                   |
| ci         | Continuous Integration/Deployment    | none          | none                   |
| revert     | Reverting a previous commit          | none          | none                   |
| wip        | Work in progress (temporary)        | none          | none                   |
