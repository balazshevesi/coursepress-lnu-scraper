# Contributing

Use Node.js 22.19+ and run `npm ci`. Keep changes focused on exporting course content faithfully.

Before submitting a change:

```sh
npm run format
npm run check
npm test
npm run build
```

For a new CoursePress layout, add a small synthetic HTML fixture to the tests and verify that content, navigation order, and relative links survive. Tests should use the local fixture server rather than depend on live course sites.

Please include the affected page URL and the error from `manifest.json` in bug reports, after removing any private information. Do not commit downloaded course material, credentials, or student information.
