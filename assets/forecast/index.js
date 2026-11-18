(function(root){
  const source = [{"schemaVersion":1,"id":"2026-09-12","title":"Gói TaylorFlow","label":"Sep–Dec 2026","validFrom":"2026-09-01","validTo":"2026-12-31","updated":"2026-11-19","sourceLabel":"đề luyện tập theo chủ đề — do TaylorFlow soạn","counts":{"part1Topics":12,"part1Questions":60,"part2CueCards":24,"part3Questions":96}},{"schemaVersion":1,"id":"2027-01-04","title":"Gói TaylorFlow","label":"Jan–Apr 2027","validFrom":"2027-01-01","validTo":"2027-04-30","updated":"2026-11-19","sourceLabel":"đề luyện tập theo chủ đề — do TaylorFlow soạn","counts":{"part1Topics":0,"part1Questions":0,"part2CueCards":0,"part3Questions":0}}];
  const localDate = value => { const parts=value.split('-').map(Number); return new Date(parts[0],parts[1]-1,parts[2]); };
  const today = new Date(); today.setHours(0,0,0,0);
  const packs = source.map(pack => { const from=localDate(pack.validFrom); const to=localDate(pack.validTo); const status=today<from?'sắp tới':today>to?'đã qua':'hiện tại'; return Object.assign({},pack,{status}); });
  packs.sort((a,b)=>a.validFrom.localeCompare(b.validFrom));
  root.TF_FORECAST_MANIFEST = {schemaVersion:1,generatedOn:"2026-11-18",packs};
})(window);
