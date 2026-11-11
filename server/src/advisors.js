'use strict';
/**
 * Rule-based advisors. Pure computation from live state — NEVER mutates state.
 * Returns {economy:[...], priorities:[...], diplomacy:[...], risks:[...]}.
 */
function advisors(state, relations = [], pendingEvents = [], prices = {}) {
  const economy = [];
  const priorities = [];
  const diplomacy = [];
  const risks = [];

  // --- economy
  if (state.treasury < 0) {
    economy.push('Your treasury is in deficit. Raise revenue or cut spending immediately — a negative treasury limits every other action.');
    priorities.push('Restore the treasury: raise taxes modestly or pause new construction until the balance is positive.');
  } else if (state.treasury < 1000) {
    economy.push(`Treasury is low at $${Math.round(state.treasury)}M. Keep a reserve before starting expensive projects.`);
  } else {
    economy.push(`Treasury stands at $${Math.round(state.treasury)}M — healthy enough for planned investment.`);
  }
  if (state.debt > state.gdp * 1000 * 0.9) {
    economy.push(`National debt ($${Math.round(state.debt)}M) exceeds 90% of GDP. Debt interest is draining the budget — prioritise repayment.`);
    priorities.push('Reduce national debt: run a surplus and avoid new borrowing-heavy projects.');
  }
  if (state.inflation > 0.10) economy.push(`Inflation is high at ${(state.inflation * 100).toFixed(1)}%. Consider raising the interest rate to cool prices.`);
  else if (state.inflation < 0) economy.push('Deflation risk: prices are falling. A lower interest rate could stimulate spending.');
  else economy.push(`Inflation is ${(state.inflation * 100).toFixed(1)}% — within a manageable band.`);
  if (state.unemployment > 0.10) {
    economy.push(`Unemployment is ${(state.unemployment * 100).toFixed(1)}% — high. Infrastructure and factory projects create jobs.`);
    priorities.push('Cut unemployment: build factories, farms and infrastructure to create jobs.');
  }
  if (state.growthRate > 0.04) economy.push(`GDP is growing at ${(state.growthRate * 100).toFixed(1)}% per year — strong momentum.`);
  else if (state.growthRate < 0.01) economy.push(`GDP growth is only ${(state.growthRate * 100).toFixed(1)}% per year. Invest in education and infrastructure to lift it.`);
  if (state.tradeBalance < -500) economy.push(`Trade balance is negative ($${Math.round(state.tradeBalance)}M). Export more of what you produce in surplus.`);
  else if (state.tradeBalance > 500) economy.push(`Trade surplus of $${Math.round(state.tradeBalance)}M — exports are earning well.`);
  const taxNote = state.taxRate > 0.30
    ? 'Tax rate is high — it funds services but drags growth and approval.'
    : state.taxRate < 0.10
      ? 'Tax rate is low — approval is helped, but revenue may be too thin for services.'
      : 'Tax rate is balanced between revenue and growth.';
  economy.push(taxNote);

  // --- priorities (lowest indices first)
  const idx = [
    ['health', state.healthIndex, 'Invest in hospitals and vaccination to raise the health index.'],
    ['education', state.educationIndex, 'Build schools and universities and raise the education budget.'],
    ['infrastructure', state.infraIndex, 'Build roads, railways and digital infrastructure.'],
  ].sort((a, b) => a[1] - b[1]);
  priorities.push(idx[0][2]);
  if (state.energyGreenPct < 30) priorities.push('Grow renewable energy — green share is below 30% and hurts your sustainability ranking.');
  if (state.literacy < 0.80) priorities.push('Literacy is below 80%. Education investment pays off in productivity and growth.');
  if (state.poverty > 0.30) priorities.push('Poverty is above 30%. Jobs programmes and housing reduce poverty over time.');
  if (state.approval < 40) priorities.push('Public approval is below 40%. Improve services and avoid further tax rises until it recovers.');

  // --- diplomacy
  const allies = relations.filter((r) => r.alliance === 'allied').length;
  const embassies = relations.filter((r) => r.embassy).length;
  const embargoes = relations.filter((r) => r.embargo);
  const hostile = relations.filter((r) => r.score < -20);
  diplomacy.push(allies === 0
    ? 'You have no formal allies yet. Propose an alliance to a friendly nation to gain influence.'
    : `You have ${allies} ${allies === 1 ? 'ally' : 'allies'} — alliances raise influence and open trade.`);
  if (embassies < 3) diplomacy.push(`Only ${embassies} ${embassies === 1 ? 'embassy' : 'embassies'} established. Embassies improve relations and trade.`);
  if (embargoes.length) diplomacy.push(`Embargo active with ${embargoes.map((r) => r.code).join(', ')} — trade with them is blocked until it is lifted.`);
  if (hostile.length) diplomacy.push(`Relations are hostile with ${hostile.map((r) => r.code).join(', ')}. Send diplomatic messages or improve relations before tensions escalate.`);
  const best = relations.slice().sort((a, b) => b.score - a.score)[0];
  if (best && best.score >= 50) diplomacy.push(`${best.code} is a close partner (relations ${best.score}). A treaty or alliance would formalise it.`);

  // --- risks
  for (const e of pendingEvents) {
    risks.push(`Unresolved ${e.name} (severity ${e.severity}) — respond with emergency funds or an international appeal before damage grows.`);
  }
  for (const d of state.diseases || []) {
    risks.push(`Disease active: ${d.name} affecting ${d.affected.toLocaleString()} people (${d.trend}). Run a vaccination campaign.`);
  }
  if (state.readiness < 40) risks.push('Military readiness is low. Increase the defence budget or recruit to restore deterrence.');
  if (state.energyGreenPct < 20) risks.push('Energy mix is heavily non-renewable — a carbon shock or fuel price spike would hit hard.');
  const worstCommodity = Object.entries(state.stockpiles || {})
    .filter(([c]) => (state.consumption || {})[c] > (state.production || {})[c])
    .sort((a, b) => ((state.consumption[b[0]] || 0) - (state.production[b[0]] || 0)) - ((state.consumption[a[0]] || 0) - (state.production[a[0]] || 0)))[0];
  if (worstCommodity && (state.stockpiles[worstCommodity[0]] || 0) < 1000) {
    risks.push(`Stockpile of ${worstCommodity[0].replace(/_/g, ' ')} is nearly empty while consumption exceeds production — buy on the market or risk shortages.`);
  }
  if (!risks.length) risks.push('No active crises. Keep reserves healthy and watch the market for price spikes.');

  return { economy, priorities, diplomacy, risks };
}

module.exports = { advisors };
