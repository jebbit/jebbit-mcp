module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  testMatch: ["**/src/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.(ts|mts)$": ["ts-jest", { useESM: true }]
  },
  extensionsToTreatAsEsm: [".ts"],
  transformIgnorePatterns: [],
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  moduleNameMapper: {
    "^(\.{1,2}/.*)\\.js$": "$1"
  }
};
