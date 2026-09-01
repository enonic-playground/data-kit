# XP property types across a lib-node read-modify-write

Settles the two questions on
[#110](https://github.com/enonic-playground/data-kit/issues/110):

1. When `repo.update({ key, editor })` hands a node through JS and takes it back, do
   properties the editor never touched keep their `PropertyTree` value types?
2. Can a property name contain `.` or `[`, making #107's composed paths ambiguous?

**Short answers: types survive, and such names are impossible.** Neither of the two
corruption paths the issue worried about is real — but three narrower ones are, and the
worst of them is the inverse of what was expected.

## Do untouched property types survive?

**They do.** Thirteen of the fourteen registered `ValueTypes` survive `repo.update` and
`repo.patch` untouched, at every nesting depth and in arrays. One does not — and two
further hazards cut across the type system rather than belonging to it. None of the three
is the failure the issue feared.

Per value type:

| Outcome | Types |
|---|---|
| Survives untouched | `String` `Boolean` `Double` `Long` `GeoPoint` `DateTime` `LocalDate` `LocalTime` `LocalDateTime` `Reference` `Link` `BinaryReference` `PropertySet` |
| Downgraded to `String` | `Xml` |

That accounts for all fourteen types in `ValueTypes`. Two hazards are **not** type-level —
they apply per property instance and can hit any of the thirteen "survives" types:

| Hazard | Applies to |
|---|---|
| Property dropped entirely | any property whose value is null, of any type |
| Downgraded to `String` | any non-primitive property the editor **touches**, if JS assigns a plain string |

So "survives untouched" means a non-null value the editor did not write. A null `Reference`
is dropped and a rewritten `Reference` is downgraded, even though `Reference` is on the safe
row.

Verified on XP 8, against the running local build. Every file on the write path is
byte-identical between tag `v8.0.3` and that build, so the result holds for the 8.0.3
this app targets.

## Why untouched properties survive

`repo.get()` and the editor do **not** see the same values, and that is the whole answer.

`NodeMapper` takes a `useRawValues` flag. `GetNodeHandler` uses the single-argument
`new NodeMapper(node)`, which leaves it `false`, so each property goes through
`MapGeneratorBase.convertValue()`, whose fallthrough is `value.toString()`. Every
`Reference`, `GeoPoint`, `Instant` and `LocalDate` reaches JS as a plain string. That is
why `detectPropertyType` in `assets/js/components/node-properties/property-tree.ts` has
to guess with a UUID regex, and why its `inferred` flag is correct as written.

The editor is built as `new NodeMapper(node, true)` (`NodeHandlerUtils.applyEditor`), so
each property goes through `convertRaw()` instead — which returns the Java object as-is,
normalizing only `Number`. The editor therefore operates on real `Reference`, `GeoPoint`,
`Instant`, `LocalDate`, `LocalTime`, `LocalDateTime`, `Link` and `BinaryReference` host
objects, not on strings.

On the way back, `NodeHandlerUtils.createEditor` runs the returned object through
`ScriptValueTranslator`, which rebuilds the tree by matching Java types:

```java
case Instant instant   -> parent.addInstant( name, instant );
case Reference reference -> parent.addReference( name, reference );
case GeoPoint geoPoint -> parent.addGeoPoint( name, geoPoint );
...
default                -> parent.addString( name, value.toString() );
```

A host object handed straight back matches its own `case` and keeps its type. XP's own
`UpdateNodeHandlerTest.keep_original_value_types_when_not_touched` asserts this on
GraalJS.

`repo.patch` is not a separate answer: `PatchNodeHandler` calls the same
`NodeHandlerUtils.prepareEditorInput`. Only persistence differs — and the probe confirms
it independently rather than resting on that reading.

## The three exceptions

### `Xml` downgrades to `String`

`ValueTypes.XML` is a `ValueType<String>` — its `getObject()` returns a `String`, and
there is no Java `Xml` class for `ScriptValueTranslator` to match on. It falls to
`default -> addString`. Any `repo.update` or `repo.patch` on a node holding an `Xml`
property rewrites it as `String`, whether or not the editor touched it, at any depth.

### Null-valued properties are dropped

`convertRaw(null)` yields JS `null`; `ScriptValueTranslator.handleValue` opens with
`case null -> {}`. The property is not preserved as a null of its type — it disappears
from the tree. This is independent of type: a null `String`, `Reference` and `Long` were
all dropped by the same write, so it reaches the thirteen types the summary calls safe.

### A touched property is only as good as what JS assigns

This is the one that matters for [#111](https://github.com/enonic-playground/data-kit/issues/111)
and [#112](https://github.com/enonic-playground/data-kit/issues/112), and it is the
inverse of the issue's premise. Untouched properties are safe precisely because the
editor never converted them. A property the editor *does* write gets whatever JS put
there — and a value that came back from the client as JSON is a plain string, which
lands in `default -> addString`.

So a naive read-modify-write is safe. A round trip through the client is not: editing
`displayName` in a form whose payload also carries `myReference` as a string downgrades
that reference, silently, with no error at write time. Writing typed values back
requires `lib-value` (`reference()`, `geoPoint()`, `instant()`, `localDate()`,
`localTime()`, `localDateTime()`, `binary()`) — which has no constructor for `Xml` or
`Link` at all.

`lib-value` is deliberately **not** added by this issue. It is not needed to answer the
question, and the shape of what #111/#112 need from it is theirs to decide.

## How it was verified

`repo.get` is the conversion under test, so it cannot be the instrument. Types were read
through `lib-export`, whose format names each value type as the element tag and marks
nulls explicitly with `isNull`. #110 named the index document instead; why it was not used
as the primary instrument, and what it was used for, is under **What the index says**
below.

A temporary `main.ts` (app bootstrap, so no HTTP auth) imported a hand-written node
export carrying all fourteen types plus nulls, a two-element array and a nested
`property-set` into a scratch repo, then exported after each step.

Baseline, abridged:

```xml
<xml name="myXml">&lt;car&gt;&lt;color&gt;Arctic Grey&lt;/color&gt;&lt;/car&gt;</xml>
<geoPoint name="myGeoPoint">8.0,4.0</geoPoint>
<reference name="myReference">abcdef01-2345-4678-9abc-def012345678</reference>
<string isNull="true" name="myNullString"/>
<reference isNull="true" name="myNullReference"/>
<long isNull="true" name="myNullLong"/>
```

### `repo.update`, editor assigning only `touchedString`

```diff
-<xml name="myXml">&lt;car&gt;&lt;color&gt;Arctic Grey&lt;/color&gt;&lt;/car&gt;</xml>
+<string name="myXml">&lt;car&gt;&lt;color&gt;Arctic Grey&lt;/color&gt;&lt;/car&gt;</string>
-<string isNull="true" name="myNullString"/>
-<reference isNull="true" name="myNullReference"/>
-<long isNull="true" name="myNullLong"/>
-  <xml name="nestedXml">&lt;a/&gt;</xml>
+  <string name="nestedXml">&lt;a/&gt;</string>
```

Everything else — including `myGeoPoint`, `myDateTime`, `myLocalTime`, `myLocalDate`,
`myLocalDateTime`, `myReference`, `myLink`, `myBinaryReference`, the two-element
`myRefArray`, and the `property-set` `mySet` with its nested `Reference` and `DateTime` —
was byte-identical.

### `repo.patch`, on its own fresh baseline

`patch` was run against a freshly re-imported node rather than after `update`, so its
effect is not inherited. Same editor, assigning only `touchedString`:

```diff
-<xml name="myXml">&lt;car&gt;&lt;color&gt;Arctic Grey&lt;/color&gt;&lt;/car&gt;</xml>
+<string name="myXml">&lt;car&gt;&lt;color&gt;Arctic Grey&lt;/color&gt;&lt;/car&gt;</string>
-<string isNull="true" name="myNullString"/>
-<reference isNull="true" name="myNullReference"/>
-<long isNull="true" name="myNullLong"/>
-  <xml name="nestedXml">&lt;a/&gt;</xml>
+  <string name="nestedXml">&lt;a/&gt;</string>
```

Identical to `update`, as the shared `NodeHandlerUtils.prepareEditorInput` predicts. Both
exceptions are therefore measured for `patch`, not inferred from `update`.

### Assigning plain JS strings to typed properties

Run under both `update` and `patch`, each from a fresh baseline. `patch` shown:

```diff
-<xml name="myXml">&lt;car&gt;&lt;color&gt;Arctic Grey&lt;/color&gt;&lt;/car&gt;</xml>
-<geoPoint name="myGeoPoint">8.0,4.0</geoPoint>
-<dateTime name="myDateTime">2014-11-28T14:16:00Z</dateTime>
-<reference name="myReference">abcdef01-2345-4678-9abc-def012345678</reference>
+<string name="myXml">&lt;car&gt;&lt;color&gt;Arctic Grey&lt;/color&gt;&lt;/car&gt;</string>
+<string name="myGeoPoint">1.0,2.0</string>
+<string name="myDateTime">2020-05-05T05:05:05Z</string>
+<string name="myReference">99999999-9999-4999-8999-999999999999</string>
```

No error was raised at write time in any run.

The probes, their seeds and both scratch repos were removed afterwards.

### What the index says, and why it was not the instrument

#110 named the Elasticsearch index document as the thing to inspect. It was not used as
the primary instrument, for a reason the results bear out: the index encodes types as
field-name suffixes and cannot distinguish `String` from `Xml` at all, so the one
type-level exception in this report would have been invisible to it. The export format
names each type as the element tag and marks nulls with `isNull`, and — like the index
document, and unlike `repo.get` — it does not pass through the JS mapper, which was the
property that actually mattered.

The index does answer a question the export cannot, though: whether a downgrade changes
how the node behaves in a query. That is the consequence #110 was worried about —
"breaking links and date range queries with no error anywhere" — so it was probed
directly, by counting query hits before and after a write that rewrites `myReference` and
`myDateTime` with **byte-identical values** supplied as plain JS strings:

```
BEFORE | _references = REF:   total=1
BEFORE | myDateTime range:    total=1
BEFORE | myReference = REF:   total=1

AFTER  | _references = REF:   total=0     <- reference tracking lost
AFTER  | myDateTime range:    total=0     <- date range query stops matching
AFTER  | myReference = REF:   total=1     <- plain equality still matches
```

The third row is why this corruption is invisible. The stored text never changed, so any
check that compares values still passes. Only the type-aware index behaviour breaks:
`_references` no longer records the link, and `myDateTime > instant(...)` no longer
matches. Nothing errors at write time, and nothing errors at read time — the node simply
stops participating in reference and range queries.

This is the concrete form of the risk #110 opened with, and it is reachable only through
the touched-property path, since untouched properties keep their types.

## Can a property name contain `.` or `[`?

Asked as a second question on #110, because #107's composed paths (`data.hero.caption`,
`data.tags[2]`) are ambiguous if a name can itself hold those characters — two distinct
properties would resolve to one path, and on the write path an edit would land on the
wrong one.

**XP rejects them.** `Property.checkName` refuses a name that is null, blank, or contains
`.`, `[` or `]`:

```java
if ( name.contains( "." ) )
{
    throw new IllegalArgumentException( "Property name cannot contain ." );
}
if ( name.contains( "[" ) || name.contains( "]" ) )
{
    throw new IllegalArgumentException( "Property name cannot contain [ or ]" );
}
```

The guard sits in `PropertyArray`'s constructor, and a named array cannot be created
without running it. Two distinct routes reach that constructor — `PropertySet.addProperty`
→ `withPropertyArray` → `getOrCreatePropertyArray`, and `PropertyTreeJson.fromArrayJson`,
which constructs the array directly and then calls `addPropertyArray` — so placing the
check in the constructor rather than in either caller is what makes it unconditional. The
two `PropertySet` call sites that also call `checkName` are read paths (`getProperty`,
`getProperties`). Identical at tag `v8.0.3`.

Confirmed on both entry points a node can arrive through.

`repo.create`:

```
control (plain name):     ACCEPTED
dot in name:              REJECTED -- Property name cannot contain .
brackets in name:         REJECTED -- Property name cannot contain [ or ]
dot in nested set name:   REJECTED -- Property name cannot contain .
closing bracket only:     REJECTED -- Property name cannot contain [ or ]
blank name:               REJECTED -- Property name cannot be blank
```

`importNodes`, with a hand-written export carrying `<string name="data.hero">` — checked
because data-kit exposes an import feature, so a node that never went through
`repo.create` can still enter a repository:

```
import added=[]
import errors=["Could not import node in folder [probe110d-seed/dotNode]: ..."]
node exists after import: false
```

The wrapped cause is the same guard, reached through the XML parser:

```
java.lang.IllegalArgumentException: Property name cannot contain .
    at com.enonic.xp.data.Property.checkName(Property.java:187)
    at com.enonic.xp.data.PropertyArray.<init>(PropertyArray.java:27)
    at com.enonic.xp.data.PropertySet.getOrCreatePropertyArray(PropertySet.java:230)
    at com.enonic.xp.data.PropertySet.addProperty(PropertySet.java:238)
```

So the path ambiguity is unreachable: no node in any repository can hold a property whose
name would collide with the path separator. **#107's composed paths need no escaping or
synthesized-id scheme, and #111 is not blocked on one.** The duplicate-React-key case the
#107 reviewer raised cannot occur either.

One caveat on scope: this covers property names inside a `PropertyTree`. Node *names* are
a different validator, and a `.` in a node name is legal — that affects node paths, not
the property paths #111 writes through.

## Two XP defects found on the way

Both were hit while building the probe, and both block anyone reproducing it — the
first stops `importNodes` outright. Recorded here so the method above can be re-run,
and because both are worth reporting upstream. Neither affects data-kit at runtime.

- **`importNodes` throws `NullPointerException` when `xslt` is omitted.**
  `ImportHandler.execute()` guards `xslt instanceof ResourceKey` but its `else` branch
  calls `xslt.toString()` unconditionally, so the optional parameter is effectively
  mandatory. Present at `v8.0.3` and unchanged since. Workaround: pass an identity
  stylesheet.
- **`export.xsd` and `XmlNodeSerializer` disagree about `allTextIndexConfig`.** The
  serializer writes it; the schema's `indexConfigs` has no such element. This stays
  invisible because `SchemaValidator` only validates documents whose root is in the
  `urn:enonic:xp:export:1.0` namespace, and XP's own exports declare no namespace — so
  a hand-written export that *does* declare it gets validated and rejected for content
  XP itself produces.

## What this means for #111 and #112

1. A read-modify-write through `repo.update` or `repo.patch` preserves the type of an
   untouched property that is non-null and not `Xml`. For those, no defensive re-typing
   is needed. The two exclusions are not edge cases — see item 2.
2. Any node carrying an `Xml` property, or a null-valued property of **any** type, is
   corrupted by any write — `update` and `patch` alike, touched or not. If the editor UI
   is allowed to save such a node, that is a real data-loss path and needs either a guard
   or a documented limitation. Note this hits `String` and `Reference` properties too when
   their value is null, despite both being on the "survives untouched" row.
3. Writing a typed property from the client requires `lib-value`, and a plain string
   assignment must be treated as a bug rather than a shortcut. `Xml` and `Link` cannot
   be written back from JS at all.
4. #107's composed paths are safe as they stand. No escaping or synthesized-id scheme is
   needed, and #111 is not blocked on one.
