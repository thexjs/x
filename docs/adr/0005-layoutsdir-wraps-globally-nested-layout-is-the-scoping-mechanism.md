---

## status: accepted

# layoutsDir wraps every route unconditionally; _layout.tsx is the only scoping mechanism

`layoutsDir` has no default directory, and setting it means every file in that directory wraps every route in the app, unconditionally — there's no filename convention that scopes one of those files to a subset of routes. A layout meant only for one subtree belongs in a nested `src/pages/<subtree>/_layout.tsx` instead, which wraps only routes in its own directory and below.

A reasonable reader's first guess is that `layoutsDir` works like Next.js's nested-layout convention — scoped by directory structure within `layoutsDir` itself. It doesn't. We kept the two mechanisms deliberately separate rather than overloading `layoutsDir` with scoping rules, because `layoutsDir` is for the small number of truly-global wrappers (an `<html>` shell, a theme provider) where "wraps everything" is the whole point, and conflating that with per-subtree layouts would make the common case (one global shell) require a directory-structure decision it doesn't need.

## Consequences

Mixing the two — a couple of truly-global layouts in `layoutsDir`, a subtree-specific one as a nested `_layout.tsx` — is the normal, correct pattern, not a workaround.
