# TSG Slackbot - AI Assistant Instructions

This is a TypeScript-based modular Slack bot framework that powers various bot functionalities in the TSG Slack workspace. The system uses a plugin-based architecture where each bot is implemented as a separate plugin. Please follow these guidelines when contributing:

## Project Architecture

### Core Components

- **Plugin System**: Modular bot plugins loaded dynamically from individual directories
- **Slack Clients**: Uses `@slack/web-api`, `@slack/events-api`, and `@slack/interactive-messages`
- **Fastify Server**: HTTP server handling Slack events and interactive messages
- **State Management**: Persistent storage system for plugin data using the `lib/state` module
- **Logging**: Structured logging with Winston logger from `lib/logger`

### Plugin Structure

Each plugin should follow this pattern:

```typescript
import type {SlackInterface} from '../lib/slack';

// Default export for event handling
export default async ({webClient, eventClient, messageClient}: SlackInterface) => {
  // Plugin initialization logic
};

// Optional server export for HTTP endpoints
import plugin from 'fastify-plugin';
import type {FastifyPluginCallback} from 'fastify';
export const server = ({webClient, eventClient, messageClient}: SlackInterface) => {
  const callback: FastifyPluginCallback = async (fastify, opts, next) => {
    // Register HTTP endpoints
    next();
  };

  return plugin(callback);
};
```

### Repository Structure

- `index.ts`: Main entry point that loads and initializes plugins
- Individual plugin directories: Each contains a self-contained bot implementation
- `bin/`: Command-line tools and scripts
- `lib/`: Core utilities (state management, logging, etc.)
- `functions/`: Firebase functions package

## Development Guidelines

### Code Standards

- Use TypeScript for new code, with proper type definitions
- Follow existing code patterns and structure
- Use modern JavaScript/TypeScript features whenever possible
- Implement proper error handling and logging using the shared logger
- When adding or editing the dependencies, make sure not to edit `package.json` or `package-lock.json` directly. Instead, use the proper `npm` commands
- Use the shared `SlackInterface` type for Slack client interactions
- When adding new environment variables, make sure to document them in the `.env.example` file
- Explicitly using `any` type should be strongly avoided. Instead, use more specific types whenever possible
- Type casting with `as` keyword should be used judiciously and only when necessary

### About helloworld directory

The code under the `helloworld/` directory is not intended to be used in production, but is intended to demonstrate coding and testing best practices for developers.

The code in this repository is a mix of modern and recommended syntax and old and deprecated syntax. The `helloworld/` directory is maintained to always be the latest and recommended syntax for slackbots, so if you're not sure what to do, follow the helloworld bot's syntax.

### Comments

Don't add useless comments that state the obvious or repeat the code. Focus on explaining the "why" behind complex logic. For example:

```typescript
// Calculate the 10th Fibonacci number
const nextFibonacci = fibonacciCalculator(10);
```

is not necessary because the code is self-explanatory. Instead, you must just remove it, or focus on explaining the purpose of the calculation or any non-obvious logic.

### Testing

- Write tests using Jest framework
- Follow existing test patterns and structure
- Use the provided `SlackMock` class for testing Slack interactions
- Place tests in `*.test.ts` files
- Run tests with `npm test -- [<test-file>]`

### Development Environment

- Run development server: `npm run dev`
- Run specific plugin only: `npm run dev -- --only [bot-id]`
- Production mode: `npm start`

## Key Guidelines

1. Follow JavaScript/TypeScript best practices and idiomatic patterns
2. Maintain existing code structure and organization
3. Write unit tests for new functionality.
4. Avoid unnecessary comments; focus on explaining complex logic