# Firebase Functions

This directory contains Firebase Cloud Functions for the TSG Slackbot.

## Setup

### Environment Variables

This project uses environment variables for configuration instead of the deprecated `functions.config()` API.

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Fill in the required values in `.env`:
   - `SLACK_TOKEN`: Slack Bot User OAuth Token (starts with `xoxb-`)
   - `AWS_ACCESS_KEY_ID`: AWS access key ID for S3 and DynamoDB access
   - `AWS_SECRET_ACCESS_KEY`: AWS secret access key for S3 and DynamoDB access

### Legacy Configuration (Deprecated)

The `.runtimeconfig.json` file and `functions.config()` API are deprecated and will be removed in March 2026. If you have existing configuration in `.runtimeconfig.json`, migrate it to `.env` file format as shown above.

## Development

### Build

```bash
npm run build
```

### Deploy

```bash
npm run deploy
```

### Testing

Tests are run from the parent directory:

```bash
cd ..
npm test -- functions/
```

## Functions

### `slackFileArchiveCronJob`

A scheduled function that runs every 60 minutes to archive Slack files to AWS S3.

**Environment Variables:**
- `SLACK_TOKEN`: Used to authenticate with Slack API
- `AWS_ACCESS_KEY_ID`: AWS credentials for S3 storage
- `AWS_SECRET_ACCESS_KEY`: AWS credentials for S3 storage

**Configuration:**
- Timeout: 300 seconds
- Memory: 1GB
- Schedule: Every 60 minutes

## Migration from functions.config()

This project has been migrated from `functions.config()` to environment variables using `firebase-functions/params`. The migration was necessary because:

1. The Cloud Runtime Configuration API (used by `functions.config()`) will be shut down in March 2026
2. Firebase CLI commands for managing configuration (`functions:config:set`, `get`, `unset`, `clone`, `export`) are deprecated
3. Deployments using `functions.config()` will fail after March 2026

For more information, see: https://firebase.google.com/docs/functions/config-env#migrate-to-dotenv
