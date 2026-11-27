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
Decide whether the vacancy is a realistic match for the candidate profile given in the text.
Rules:
- "requires_experience" is true only when the vacancy clearly asks for 1 year or more of commercial experience. "Experience is a plus" or internships do not count.
- "fit" is false for software development, design, pure sales or customer support roles, and for anything the profile says is not interesting.
- Write "why" in Ukrainian, plain and specific, no more than 15 words.
Only extract the requested fields.`;

module.exports = { FIT_SCHEMA, FIT_PROMPT };
