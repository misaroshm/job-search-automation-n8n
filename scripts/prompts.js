// AI prompt and schema for the vacancy fit check.
// Shared by build.js (n8n workflow) and eval-filter.js (offline evaluation).

const FIT_SCHEMA = {
  type: 'object',
  properties: {
    fit: { type: 'boolean', description: 'Is this a realistic, relevant role for the candidate?' },
    requires_experience: { type: 'boolean', description: 'true only if the vacancy explicitly requires 1+ year of commercial experience' },
    why: { type: 'string', description: 'One short sentence in Ukrainian (max 15 words): why it fits or not' },
  },
  required: ['fit', 'requires_experience', 'why'],
};
const FIT_PROMPT = `You screen job vacancies for one specific entry-level candidate.
Decide whether the vacancy is worth showing to the candidate, using the profile given in the text.
Rules:
- Treat the profile as preferences, not hard rules. "fit" means the candidate would plausibly want to see this vacancy; when in doubt, "fit" is true.
- "fit" is false only for clear mismatches: roles for experienced specialists, software engineering as the main job, sales-only roles, customer support, or anything else the profile lists as usually not a fit.
- Location or office format alone is never a reason for "fit" to be false.
- "requires_experience" is true only when the vacancy clearly asks for 1 year or more of commercial experience. "Experience is a plus" or internships do not count.
- Write "why" in Ukrainian, plain and specific, no more than 15 words.
Only extract the requested fields.`;

module.exports = { FIT_SCHEMA, FIT_PROMPT };
