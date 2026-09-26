/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // The app itself runs under ts-node-dev --transpile-only, and the
        // repository has a long-standing backlog of type errors in unrelated
        // files. Isolated modules keeps the test run fast and stops those
        // pre-existing errors from failing tests that do not touch them.
        isolatedModules: true,
        diagnostics: false,
      },
    ],
  },
};
