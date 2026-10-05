# Fixture: a plan that plan-lint must reject

| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme (messbares Signal) |
|---|---|---|---|---|---|---|---|---|
| OK-01 | clean row | ci | – | B | S | – | x | Exit 0 |
| SIZE-01 | size L | ci | – | B | L | – | x | Exit 0 |
| TIER-01 | tier D | ci | – | D | S | – | x | Exit 0 |
| LANE-01 | unknown lane | zzz | – | B | S | – | x | Exit 0 |
| ACC-01 | empty acceptance | ci | – | B | S | – | x |  |
| SEAM-01 | first on api.rs | api | api.rs | A | S | – | x | Exit 0 |
| SEAM-02 | parallel on api.rs | api | api.rs | A | S | – | x | Exit 0 |
| DEP-01 | unknown predecessor | ci | – | B | S | NOPE-99 | x | Exit 0 |
