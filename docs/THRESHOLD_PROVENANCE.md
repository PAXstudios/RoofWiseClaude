# Where the hit-count thresholds actually come from — an owner decision

**Status: OPEN QUESTION FOR THE OWNER. No threshold has been changed.**

Raised by the owner (2026-09-03): *"make sure this is accurate according to Haag:
'6.9 hail hits per 100 sq ft test square' — I thought it was 9 hits constitutes a
damaged slope. Also if all four slopes are damaged by the threshold number of hail
hits, then it needs a full replacement, I think, check this."*

Plus the tension I flagged earlier: `docs/HAAG_DECISION_ENGINE.md` §4 branches on
`hail_hits_per_square >= 8 → FULL_REPLACEMENT`, while §2 puts the 3-tab material
threshold at `> 5`. A 6.9/square 3-tab roof falls between them.

`CLAUDE.md` says the Drive documents win on thresholds and that I must not quietly
change a documented number. So this is research and a recommendation, not a change.

---

## What HAAG actually publishes

I went to the primary sources rather than answering from memory. The result
reframes the question.

**1. HAAG does not publish a hit-count threshold at all.**

HAAG's own Test Square Method page describes drawing a 10×10 ft square on each
directional slope and instructs the inspector to *"record and differentiate the
types of marks or physical damage found"* and *"determine a count of how many
roofing units have been hail-damaged in the test square."* That count exists to be
**extrapolated across the roof through the DURA formula** — `Repair Cost = D × U × R × A`,
the same §5 formula this app implements. It is an input to a cost calculation, not
a number to compare against a threshold.

**2. HAAG's damage test is qualitative, not numeric.**

Functional damage is *"diminution in water-shedding capability or reduction in the
expected long-term service life."* For asphalt specifically, Marshall & Herzog
(1999) define functional hail damage as **punctures, tears, or fractures (bruises)
in the shingle mat** — a bruise being an indentation with a fracture that feels
soft. Whether a mark counts is a physical determination about the mat. It is not
settled by how many marks there are.

**3. The numbers everyone quotes are CARRIER conventions.**

Across the industry sources: **8 hits is the most commonly cited figure**, with the
working range **7–10 functional impact marks per 100 sq ft test square**, and
carriers frequently asking for **8–10 on at least two slopes**. The owner's
recollection of "9 hits" sits squarely inside that band. None of it is HAAG.

---

## What this means for our numbers

| | 3-tab | Laminate / architectural |
|---|---|---|
| `docs/HAAG_DECISION_ENGINE.md` §2 (today) | **> 5** | **> 8** |
| §4 decision tree (today) | `>= 8 → FULL` regardless of material | same |
| Carrier norm from the research | 8–10 | 8–10 |
| HAAG published threshold | *none* | *none* |

Two things follow.

**The §2/§4 mismatch is not a transcription gap — it is two different
provenances colliding.** The tree's `>= 8` matches the carrier norm. The §2 `> 5`
does not match anything I can source. They disagree because they came from
different places, which is why a 6.9/square roof falls in the gap.

**Our 3-tab threshold is stricter than every carrier norm I can find.** At `> 5`
the app tells a roofer they have a case at 6 hits per square, when the adjuster
standing on that roof wants 8–10. That is the failure mode this product exists to
prevent: a confident packet that gets denied costs the contractor $5–20K and costs
us the roofer's trust. Being stricter than the carrier is not conservative — it is
wrong in the expensive direction.

Note that `haagThresholds.ts` carries a correction notice saying an earlier
implementation used 8 and 10 and that "both were wrong." Against this research,
those earlier values were **closer to carrier practice** than the current ones.

---

## The three options

**A. Leave §2 as written.** The Drive document is the authority and may reflect a
HAAG course position not published on the public site. Cost: the app keeps calling
replacement at counts carriers reject.

**B. Align §2 to the carrier norm (> 8 for both asphalt families).** Removes the
§2/§4 mismatch — the tree's `>= 8` and the material rule become one number. Cost:
the app stops flagging 6–8 hit roofs that a sympathetic adjuster might have paid.

**C (recommended). Report both, decide on neither.** Keep §2 as the app's internal
trigger, and make every surface state the count against BOTH bars: *"6.9 hits per
square — above the RoofWise 3-tab threshold of 5, below the 8–10 most carriers
ask for."* The roofer then knows exactly how hard the conversation will be before
they file. The machinery for this already exists and is unused —
`CARRIER_IMPACT_NORM_NOTE` in `decisionEngine.ts` says almost exactly this and is
currently only report-language.

C is what I would ship. It is the only option that does not require guessing which
document is right, and it is more useful to the roofer than either number alone.

---

## The owner's second question: all four slopes

*"if all four slopes are damaged by the threshold number of hail hits, then it
needs a full replacement, I think"*

**This is already how the engine behaves, and the real rule is stronger than that.**

§4 escalates to `FULL_REPLACEMENT` when functional damage spans **more than 2**
slopes, so three or four qualifying slopes already returns full replacement today.

But the research surfaces a stronger and more valuable argument the app is not
making. Most carriers score each slope independently and pay only the qualifying
slopes — **however, matching frequently carries the whole roof**: shingles must
match across a plane, and manufacturer warranties do not permit partial
replacement on matched planes. Several sources report carriers approving a full
roof off a **single** qualifying slope for that reason alone.

The engine already has the gate for this. `§3 appearance_match_impossible` forces
`FULL_REPLACEMENT` on its own — and **nothing in the app ever sets it.**
`engineInputFromInspection` leaves it undefined because the data model has no
field for it.

That is a concrete, sourceable gap worth closing regardless of how the threshold
question is decided: capture whether the shingle is discontinued or unmatchable
(the inspector knows, or the manufacturer/line is identifiable from the photos),
and the matching argument starts appearing in packets that currently argue only
hit counts.

---

## Sources

- [Haag — Test Square Method](https://haagglobal.com/featured-post/testsquaremethod/)
- [Haag — Test Square Method (2019)](https://haagglobal.com/articles/april-2019-blog-post/)
- [Haag — Hail Damage to Asphalt Roof Shingles (P 9.4)](https://haagglobal.com/wp-content/uploads/2022/06/hail-damage-to-asphalt-shingles.pdf)
- [Haag — A White Paper: Hail Damage to Composition Shingles](https://haagglobal.com/wp-content/uploads/2022/08/A-White-Paper-Hail-Damage-to-Composition-Shingles-04_2006.pdf)
- [InterNACHI — Mastering Roof Inspections: Hail Damage, Part 12](https://www.nachi.org/hail-damage-part12-39.htm)
- [Nelson Forensics — Guidelines to Assess Hail Damage to Shingle Roofs](https://www.nelsonforensics.com/wp-content/uploads/2018/10/Guideline-to-Assess-Hail-Damage-to-Shingle-Roofs-.pdf)
- [Protocol for Assessment of Hail-Damaged Roofing (ResearchGate)](https://www.researchgate.net/publication/327022554_Protocol_for_Assessment_of_Hail-Damaged_Roofing)
