/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  overrides: [
    {
      files: ['**/*.{vue,html}'],
      extends: ['stylelint-config-recommended-vue']
    }
  ],
  ignoreFiles: [
    '**/dist/**',
    '**/node_modules/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/blob-report/**',
    'packages/*/test/tmp/**'
  ],
  rules: {
    'selector-class-pattern': null,
    'custom-property-pattern': null,
    'no-descending-specificity': null,
    'rule-empty-line-before': null,
    'declaration-empty-line-before': null,
    'comment-empty-line-before': null,
    'at-rule-empty-line-before': null,
    'media-feature-range-notation': null,
    'import-notation': null,
    'value-keyword-case': null,
    'property-no-vendor-prefix': null,
    'color-function-notation': null,
    'alpha-value-notation': null,
    'comment-whitespace-inside': null,
    'declaration-block-no-redundant-longhand-properties': null,
    'declaration-property-value-keyword-no-deprecated': null,
    'declaration-block-no-shorthand-property-overrides': null,
    'declaration-block-single-line-max-declarations': null,
    'custom-property-empty-line-before': null,
    'font-family-name-quotes': null,
    'selector-not-notation': null,
    'color-function-alias-notation': null
  }
};
