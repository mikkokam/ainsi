/* A stylesheet imported for its text: `import css from "./style.css" with { type: "text" }`.
   Bun resolves this at run time; the declaration is so an editor and tsc agree with it. */
declare module "*.css" {
    const text: string;
    export default text;
}
