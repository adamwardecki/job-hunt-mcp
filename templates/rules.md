# Rules

<!--
Rules are your standing preferences and corrections. They live in the tracker (add_rule, list_rules,
deactivate_rule), not in this file. This template shows what a good rule looks like, so the ones
you add by hand or via /job-hunt:correct are usable by a future run that has never seen the conversation.
-->

Every rule has four parts:

| Field | What it holds |
|---|---|
| **text** | The rule, imperative, one or two sentences. Says what to do and where the line is. |
| **reason** | Why. What went wrong, or what you said. A rule with a reason generalises correctly to new cases. |
| **example** | The concrete case that produced it: company, role, the quote involved. |
| **date** | Set automatically (`added_on`). Later rules win over earlier ones on the same point. |

## Good rules

```
text:    Drop a role on location only after quoting the employer's own posting. Aggregator tags are leads.
reason:  A role was dropped as "UK only" from a job-board tag; the employer's page said "Remote - International".
example: <Company>, <Role>: board tag "UK", ATS location line "Remote - International".
date:    <YYYY-MM-DD>
```

```
text:    Customer calls inside a product role are fine. Drop only roles that ARE forward-deployed
         (the main job is building inside customers' codebases or being embedded with customers).
reason:  A product role was flagged because it mentioned joining partner calls. User: "joining calls is fine".
example: <Company>, <Role>: "you'll join customer calls to understand integrations".
date:    <YYYY-MM-DD>
```

```
text:    Answer salary fields in the currency and period the field asks for. Convert at the day's rate.
reason:  A field asking for "gross, in $" got a figure in another currency.
example: <Company> form: "Salary expectations (annual, gross, in $)".
date:    <YYYY-MM-DD>
```

## Weak rules (avoid)

- "Be careful with locations." (No line, no action.)
- "Don't apply to <Company>." (No reason: a future run cannot tell if it still applies. Add why.)
- "Never mention gaps, except sometimes." (Contradicts itself. Split into two rules with their scope.)

## Narrow overrides

An override of one case is not a reversal of the rule. If you say "apply anyway" to one role, the
rule stays and the role gets an event with `actor: user`. Only replace a rule when you mean it to
change for every future case; then deactivate the old one.
