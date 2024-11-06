import cds from '@sap/cds/eslint.config.mjs'
export default [
    {
        ignores: ["cap/*"]
    },
    ...cds.recommended,
]
