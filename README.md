# Favordex

Rank the National Dex by how much **you** like each Pokémon. Favordex shows two species at a time. Every answer updates a personal Bradley–Terry ranking. Nothing leaves the browser: there is no account and no server.

The ranked unit is the **base species** (National Dex #1 through the latest in PokéAPI, 1,025 as of this bundle). Every alternate form — Mega, Gigantamax, regional, and the rest — is drawn on that species' card. One vote covers all of them. They are not separate ranked entries.

The **Pokédex** menu changes the device, not just the colors: the red Kanto unit, the Johto flip pad, the orange Omega Ruby / Alpha Sapphire handheld, the Sinnoh book, the Unova slab, the Kalos hex frame, the red Alola Rotom Dex, the Galar Rotom Phone on its side, and the Paldea notebook. That choice is saved in this browser under `favordex.dex.v1`.

## Run it

Open `index.html` in a browser. Double-click it, or from this folder:

```powershell
start index.html
```

That is the whole setup. There is no install step and no dev server. The species list, traits, and artwork are already in this folder, and the page keeps working with the network off. Answers stay in this browser.

The scripts are ordinary JavaScript files, not modules, so the page loads from a `file://` address. Artwork paths are relative (`artwork/p6.webp`), which is what a local file can display.

## Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Pick the left species, every form | Click or tap the left card, or swipe left | `←` |
| Pick the right species, every form | Click or tap the right card, or swipe right | `→` |
| Tie | Tie | `↓` |
| Skip | Skip | `↑` |
| Undo the last answer | Undo | `Backspace`, `Ctrl+Z`, or `Cmd+Z` |

Forms overlap in one picture (a triangle for three, a diamond for four, a ring when there are more). A click or swipe on the card picks the species, every form. The left and right cards stay the same size either way.

**Rankings** is the full order, with a score, a Laplace uncertainty, and how many matchups that species has been in. Filter by type or generation, or search by name. The header shows the matchup count and a confidence percentage.

**Model** names the predictor: hierarchical Bradley–Terry, strength `s = x·w + b`, the normal priors on the weights and the species offsets, and the alternating Newton fit. Under that it lists every trait category in `x` — type, generation, color, shape, habitat, egg group, legendary, mythical, baby, evolution stage, and starter — and the learned weight and Laplace standard deviation of each column.

**Export** downloads the full answer history as JSON. **Import** replaces the current history. **Reset** clears it. History lives in `localStorage` under `favordex.history.v1`. Skips are kept in that log so they can be undone and round-tripped, and they do not affect scores.

## The model

### Bradley–Terry

Each species $i$ has a strength $s_i$. The chance that $i$ beats $j$ in a decisive duel is

$$
P(i \succ j) = \sigma(s_i - s_j), \qquad \sigma(x) = \frac{1}{1+e^{-x}}.
$$

The fit uses the whole comparison history and does not care about the order the answers arrived in.

### Ties and skips

A tie is a **half-win** for each side. Its log-likelihood contribution is

$$
\tfrac{1}{2}\log \sigma(s_i-s_j) + \tfrac{1}{2}\log \sigma(s_j-s_i),
$$

which is symmetric in the two species and is largest when their strengths are equal. It does not crown a winner. (The Davidson tie model is the other standard extension; half-wins keep the same Hessian shape as a decisive game, which makes the Laplace step simple.) A skip is not a comparison.

### Traits and partial pooling

Strength is not a free number. It is

$$
s_i = x_i^\top w + b_i.
$$

$x_i$ is a feature vector: one column per type the species has, one per generation, and optional columns for color, shape, habitat, egg group, legendary, mythical, baby, evolution stage, and starter. $w$ is a weight vector **learned from your answers**. $b_i$ is that species' own offset.

Priors:

$$
w \sim \mathcal{N}(0, \sigma_w^2 I), \qquad b_i \sim \mathcal{N}(0, \sigma_b^2)
$$

with $\sigma_w = 0.7$ and $\sigma_b = 1$. The prior on $b_i$ is the partial-pooling knob. A species you have barely rated stays near the strength its traits predict, because the offset is pulled toward 0. A species you have rated many times follows those picks: the likelihood overwhelms the prior. When two species are nearly tied on direct evidence, the one whose traits you have preferred ranks higher. The prior also pins the additive invariance of Bradley–Terry, so strengths cannot all drift upward together.

Adding a trait later is a new extractor next to the others in `js/model.js` (each one returns a map of column name to number, and `extendedExtractors` is the list the page uses). If it needs data PokéAPI can supply, add the field in `scripts/fetch-pokemon.mjs` and pass it through `toTrait` in `js/ranker.js`. The fitter does not change. Columns are the sorted union of whatever the extractors emit.

### Fitting

The negative log posterior is convex (logistic loss of a linear score, plus a quadratic prior). We maximize it by alternating Newton steps: an exact Newton update on $w$ (only a few dozen columns), then Gauss–Seidel Newton sweeps on each offset, warm-started from the previous answer. Uncompared offsets stay at 0.

### Uncertainty

Uncertainty is a Laplace approximation at that mode. The individual-offset block of the Hessian is treated as diagonal. Trait-weight covariance is the matching Schur complement, inverted exactly. The reported standard deviation for species $i$ is the marginal Laplace sd of $s_i$, including the covariance between $w$ and $b_i$. Before any answers it matches the prior

$$
\mathrm{Var}(s_i) = \sigma_b^2 + \sigma_w^2 \lVert x_i \rVert^2.
$$

Direct matchups shrink it. The rankings page draws that sd as the uncertainty bar.

**Confidence** in the header is one minus the ratio of mean posterior variance to mean prior variance, clipped to $[0, 1]$. Zero means every species is still as uncertain as the prior. It is not a fraction of the sorting bound below.

### Which pair comes next

The next duel maximizes expected information gain of one decisive comparison. With the Laplace posterior, the margin $\delta = s_i - s_j$ is approximately $\mathcal{N}(\mu, v)$, and the answer is a coin flip with probability $\sigma(\delta)$. The gain is the mutual information

$$
I(\theta; y) = H[y] - \mathbb{E}[H[y \mid \delta]].
$$

$H[y]$ uses the integrated predictive probability, $\sigma\!\left(\mu / \sqrt{1 + \pi v / 8}\right)$. The expected conditional entropy is a 7-point Gauss–Hermite quadrature. Difference variance uses the trait coordinates of the weight covariance plus each offset's Laplace variance (offset correlations are the part this approximation drops).

Scoring every pair of 1,025 species is unnecessary. Candidates are a window of neighbors in the current strength order, extra pairs among the least-certain species, and a few hundred random pairs (more while the ranking is still flat). An exploration draw, about 12% of the time, pairs a species that has been shown the least with someone else, so nobody is starved. Among the best few candidates the app picks at random, which keeps the next card from feeling like a fixed script. That shortlist scores in well under 100ms.

### Why 8,800 is a floor, not a finish line

A noiseless comparison sort needs at least $\log_2(n!)$ binary answers to identify one ranking out of $n!$ possibilities. For the 1,025 species in this bundle that is

$$
\log_2(1025!) = 8779 \text{ bits},
$$

about 8,800. Stirling's approximation $n\log_2 n - n\log_2 e + \tfrac{1}{2}\log_2(2\pi n)$ lands in the same place. The app prints the exact sum for whatever dex size is bundled.

That number assumes every answer is a perfect, adversarial split: the asker is always 50/50, and the answer is never wrong. A real preference is neither.

- A yes/no answer is worth at most 1 bit, and only when the model was genuinely unsure. Once a pair is lopsided, the reply is predictable and carries a fraction of a bit (its binary entropy).
- Taste is noisy. The same two species can go either way. Bradley–Terry treats each answer as a coin flip, so a gap of 0.2 logits (about a 55/45 lean) is not settled by one duel. Posterior variance falls only as evidence piles up, roughly like $1 / (n_{\text{eff}}/4 + 1/\sigma^2_{\text{prior}})$.
- You do not need all $\binom{1025}{2}$ pairs. Indirect comparisons and the trait model share strength, which is why an unrated Pokémon still has a sensible draft score after a few hundred votes. Sharing strength does not repeal the lower bound. Resolving the close calls to a stable credible interval takes **more** than 8,800 comparisons, not fewer, because noise spends bits that a perfect sort would have saved.

The header's confidence meter is the practical progress readout. The 8,800 figure is there so the meter is not mistaken for "percent of a finished sort."

## Tests

The checks use Node's built-in test runner. Node is only for that, and for rebuilding the bundle. Opening the page does not need it.

```bash
node --test
```

The suite covers the fit (including a numerical gradient check at the mode), half-win ties, skips, multi-level undo, trait-weight learning, partial pooling, the Laplace prior variance, and pair selection. One simulation hides a true strength vector, answers with noisy Bradley–Terry preferences, and checks that information-gain pairing reaches a higher Kendall tau than random pairing after the same number of duels. Another checks that choosing the next pair among all 1,025 species stays under 100ms.

## Project layout

- `index.html`, `styles.css`, `js/app.js` — the page
- `js/model.js` — features, fit, selection, history, summary
- `js/ranker.js` — answer log, storage, and the live ranking
- `data/pokedex.js` — the dex, inlined so the page does not have to fetch JSON
- `data/pokemon.json` and `artwork/` — the same offline bundle
- `scripts/fetch-pokemon.mjs` — optional PokéAPI refresh

Four ride forms of Koraidon and Miraidon have no sprite in the PokéAPI artwork set. Those forms show a monogram instead of artwork; the species still rank.

Rebuilding that bundle is optional. It needs Node and the `sharp` package, then `node scripts/fetch-pokemon.mjs` from this folder. The copy already in the repo is what the page uses.
