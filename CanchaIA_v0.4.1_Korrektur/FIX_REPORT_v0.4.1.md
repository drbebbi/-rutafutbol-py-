# CanchaIA v0.4.0 → Korrektur von drei Befunden (Stand 27.10.2026)

Ausschließlich die drei beauftragten Fehler wurden behoben. Unverändert sind Marke, Layout, Sprachen, Zeitzone, Tarife, Zahlungen, Anmeldung, Rollen, Sicherheit, Datenanbieter, API-Konfiguration, Prognosemodelle, Modellparameter, Mindest-EV, Strategie, Empfehlungsgrenzen und das Frontend.
Es gibt keine Migration, keine Paketänderungen und keine echten API-Abrufe.

## 1. Reproduktion (vor jeder Änderung, auf unverändertem v0.4.0)

| Befund | Reproduziert? | Nachweis |
|---|---|---|
| 1 Modellfreigabe nach fehlgeschlagener Prüfung | **ja** | `docs/test-evidence/repro_fix1.txt`: 4 von 6 neuen Tests schlagen fehl (VALIDATED→FAILED, VALIDATED→UNVALIDATED, gemischte Märkte, Wettbewerbstrennung). Die zwei übrigen sind Schutztests. |
| 2 Backtest zeitlich nicht wie live | **ja** | `docs/test-evidence/repro_fix2.txt`: Testliga mit 69 Kandidaten. **7** Kandidaten wären zu ihrem eigenen Entscheidungszeitpunkt unter den Top 5 gewesen, wurden aber nachträglich durch **spätere** Kandidaten desselben Kalendertags verdrängt. Das Modellgewicht war einheitlich 0,35; freigegebene Marktgewichte wurden ignoriert. |
| 3 Wettbewerbs-IDs gehen verloren | **ja** | `docs/test-evidence/repro_fix3.txt`: 4 von 4 Tests schlagen fehl. Bei nur EPL-Spielen wurden `/odds` für EPL **und** La Liga abgerufen. Bei knappem Budget wurde alphabetisch statt nach nächstem Anstoß gewählt. Ohne oder bei mehrdeutiger Zuordnung wurden pauschal alle Wettbewerbe kostenpflichtig abgefragt. |

## 2. Geänderte Dateien und Grund

| Datei | Grund |
|---|---|
| `backend/src/engines/prediction/index.ts` | **Fix 1:** `effectiveScopeValidation()` liefert je Markt den **jüngsten** Prüfstand (optional zu einem Stichtag `asOf`). `scopeRelease()` leitet daraus Freigabe, Marktvorteil und Mischgewicht ab. `currentModelVersion()` nutzt nur noch diesen Stand; Gewichte kommen je Markt aus der Version des maßgeblichen Eintrags. **Fix 2:** optionaler Stichtag. |
| `backend/src/engines/coverage.ts` | **Fix 1:** Die Datenübersicht nutzt dieselbe Funktion `effectiveScopeValidation()` wie die Engine. |
| `backend/src/engines/value.ts` | **Fix 2:** gemeinsame Regeln `releaseSettings()`, `weightFor()`, `validatedFor()`, `marketEdgeFor()`. Gewichtspriorität wie bisher live: manuell > freigegeben je Markt > Standard. Live-Verhalten unverändert. |
| `backend/src/engines/discovery.ts` | **Fix 2:** nutzt `releaseSettings()` (gleiches Ergebnis wie vorher, jetzt gemeinsam mit dem Backtest). **Fix 3:** `fixturesForEvents()` übernimmt die eindeutige Wettbewerbs-ID des jeweiligen Providers aus `competition_aliases`; bei fehlender oder mehrdeutiger Zuordnung bleibt sie leer. `oddsFixturesFor()` setzt für Fixtures anderer Provider den Sport-Key von The Odds API desselben Wettbewerbs. |
| `backend/src/providers/theOddsApi.ts` | **Fix 3:** Quoten nur für die Sport-Keys der priorisierten Spiele. Spiele ohne eindeutige oder ohne freigegebene ID werden mit konkretem Grund übersprungen (`report.notes`); es gibt keinen Rückfall auf alle Wettbewerbe. Budgetpriorität nach nächstem Anstoß funktioniert jetzt, weil die IDs ankommen. Limits und BTTS-Regeln unverändert. |
| `backend/src/engines/recommendation.ts` | **Fix 2:** `simulateTimeline()` bildet den Live-Ablauf chronologisch nach (je Zeitpunkt `selectTop()`, eingefroren beim ersten Erscheinen, einmal gezählt). |
| `backend/src/engines/backtest.ts` | **Fix 2:** `simulateBets()` arbeitet chronologisch über die Entscheidungszeitpunkte statt über Kalendertage. Freigaben und Mischgewichte gelten so, wie sie **zum Entscheidungszeitpunkt** existierten; nichts kommt aus der Zukunft oder dem Holdout. Die Simulation ist ausdrücklich als **eingeschränkt** gekennzeichnet. Die Kennzeichnung geschätzter CSV-Zeitpunkte bleibt. |
| `backend/src/engines/validation.ts` | **Fix 2:** Berichtszeile an die neuen Auswahlkennzahlen angepasst. |
| `backend/test/v041_fix1_scope_release.test.ts` (neu) | Regressionstests Fix 1 (6) |
| `backend/test/v041_fix2_backtest_timeline.test.ts` (neu) | Regressionstests Fix 2 (6) |
| `backend/test/v041_fix3_competition_ids.test.ts` (neu) | Regressionstests Fix 3 (4), über den vollständigen Ablauf DB → Sync → Provider |
| `backend/test/v040_p2_backtest.test.ts` | **Angepasst:** prüfte die Kennzahlen des fehlerhaften Tagesfensters (`windows`, `maxBetsInAWindow`, `beyondWindowLimit`). Er prüft jetzt dieselben Grenzen (≤ 5 aktiv, ≤ 1 je Spiel) für die chronologische Regel. |
| `backend/test/v040_p3_odds_api.test.ts` | **Angepasst:** Der lastEvents-Test übergab ein Fremd-Fixture **ohne** Wettbewerbs-ID und setzte damit den pauschalen Rückfall auf alle Wettbewerbe voraus (Befund 3). Er bekommt jetzt den Sport-Key, den `fixturesForEvents()` liefert. Die geprüfte Filterlogik ist unverändert. |
| `docs/test-evidence/*` | Reproduktions- und Testausgaben |

## 3. Tatsächliche Testergebnisse (Node 22.22.0)

| Prüfung | Ergebnis |
|---|---|
| Typprüfung Frontend + Backend (`npm run typecheck`) | fehlerfrei |
| Build Frontend + Backend (`npm run build`) | erfolgreich |
| Backend-Testsuite | **185/185 bestanden** (Ausgang 169 + 16 neu), 0 fehlgeschlagen, 0 übersprungen |
| Echte API-Abrufe | keine |

## 4. Verbleibende Einschränkungen dieser drei Bereiche

1. **Fix 2 – eingeschränkte Simulation:** Je Spiel liegt nur ein Entscheidungszeitpunkt mit Modellinformation vor (Anstoß − 60 min), mit den dann verfügbaren, bei CSV **geschätzt** datierten Quoten. Live wird stündlich neu bewertet. Dadurch sind in den Testdaten selten mehrere Empfehlungen gleichzeitig aktiv (beobachtet: höchstens 1), und das Limit von 5 greift kaum. Frühere Zeitpunkte werden nicht erfunden. Die Kennzeichnung steht in `selection.restricted` und in der Simulationsnotiz.
2. **Fix 2 – Freigaben in historischen Backtests:** Prüfstände entstehen erst, wenn der Backtest läuft. Für historische Entscheidungszeitpunkte existiert daher in der Regel keine Freigabe, und es gilt das Standardgewicht der Strategie. Das ist korrekt (keine Information aus der Zukunft), bildet aber die spätere Live-Situation mit Freigaben nicht ab.
3. **Fix 2 – nicht Teil dieses Auftrags:** Die Ensemble-Gewichte der Einzelmodelle im Backtest stammen weiterhin aus dem Walk-Forward-Teil vor dem Holdout. Live gelten sie erst nach einer Freigabe. Das ist eine Modellfrage und wurde bewusst nicht verändert.
4. **Fix 1:** Maßgeblich ist der jüngste Eintrag in Prüfreihenfolge (`id`). Stammen freigegebene Märkte eines Wettbewerbs aus verschiedenen Prüfläufen, heißt die Modellversion in neuen Prognosen z. B. `ensemble-1.1.0+bt5 + ensemble-1.1.0+bt3`.
5. **Fix 3:** Spiele ohne eindeutige Zuordnung bekommen bewusst keine Quoten. Fehlende Zuordnungen müssen im Admin-Bereich bzw. in `competition_aliases` gepflegt werden. Live mit echtem Schlüssel ist das nicht geprüft; alle Tests nutzen nachgebaute Antworten.

Separat beobachtet und nicht behoben (außerhalb des Auftrags): keine weiteren Befunde.
