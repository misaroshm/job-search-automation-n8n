// Removes the routing field so the Sheets node only sees real columns
// (it creates missing columns such as "AI-коментар" automatically).
return $input.all().map((i) => {
  const j = Object.assign({}, i.json);
  delete j.kind;
  return { json: j };
});
