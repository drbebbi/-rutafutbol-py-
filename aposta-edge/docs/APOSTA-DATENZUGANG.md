# Aposta.la-Quoten – Datenzugang

## Prüfergebnis (10.10.2026)
- `https://aposta.la/robots.txt`: `Disallow: /api/` – automatischer Zugriff auf die Schnittstelle ist untersagt.
- Die Seite nutzt **Cloudflare Turnstile** (Bot-Schutz). Ein automatisches Auslesen müsste diesen Schutz umgehen.
- Eine öffentliche oder dokumentierte Odds-Schnittstelle ist nicht erkennbar.

**Folge:** Die App liest Aposta.la **nicht automatisch** aus. Es gibt zwei zulässige Wege.

## Weg 1 – sofort: Erfassung durch einen Admin
Admin → **„Capturar cuotas de Aposta.la“**
1. Spiel auf aposta.la öffnen, URL kopieren und einfügen (daraus wird die Aposta-Event-ID gelesen).
2. Teams, Wettbewerb, Anstoß (Ortszeit Paraguay) eintragen.
3. Die gerade angezeigten Quoten eintragen: 1X2, Über/Unter 2,5, Beide treffen (ganze Märkte oder gar nicht).
4. Bestätigen: „Acabo de leer estas cuotas en aposta.la“ → **Guardar cuotas**.

Was dann passiert:
- Zeitstempel = Serverzeit der Speicherung. Die Quoten gelten **30 Minuten** als aktuell; danach erneut erfassen.
- Die Erfassung gilt als vom Admin bestätigt (Herkunft verifiziert), die Quoten werden als unveränderliche Snapshots gespeichert.
- Prognose und Value-Berechnung laufen sofort für dieses Spiel.
- Tippfehler-Schutz: Quoten außerhalb 1,01–1000 oder eine Buchmachermarge < 0 % bzw. > 25 % werden abgelehnt.

Damit die KI eine **Prognose** liefern kann, braucht das Spiel zusätzlich Team-Statistiken (API-Football: `API_FOOTBALL_KEY`, Mapping, „Team Stats“). Damit sie etwas **empfiehlt**, muss außerdem das Modell validiert sein (siehe AUDIT.md). Ohne das zeigt die KI die echten Aposta-Quoten und Zahlen, sagt aber ehrlich „sin recomendación“.

## Weg 2 – dauerhaft: offizieller Feed von Aposta.la
Der Adapter in der App ist bereits fertig. Er braucht nur zwei Adressen (`APOSTA_EVENTS_ENDPOINT`, `APOSTA_ODDS_ENDPOINT`) mit einem JSON-Format; ein abweichendes Partnerformat lässt sich mit geringem Aufwand anbinden.

### Anfrage an Aposta.la (Spanisch, zum Kopieren)

> **Asunto:** Solicitud de acceso a datos de cuotas deportivas (feed oficial / afiliados)
>
> Estimado equipo de Aposta.la:
>
> Desarrollamos **Aposta Edge AI**, una plataforma de análisis estadístico de fútbol para usuarios en Paraguay. Mostramos las cuotas de Aposta.la junto a probabilidades calculadas por modelos matemáticos y enlazamos cada partido directamente a su página en aposta.la.
>
> Su archivo robots.txt excluye el acceso automatizado a /api/, y lo respetamos. Por eso les consultamos si ofrecen un **feed oficial de cuotas** (programa de afiliados o socios de datos) con:
> - partidos de fútbol próximos (ID del evento, equipos, competición, hora de inicio),
> - cuotas pre-partido de 1X2, Más/Menos 2,5 goles y Ambos marcan, con estado del mercado (abierto/suspendido) y hora de actualización,
> - enlace al evento en aposta.la.
>
> Nos adaptamos al formato que ustedes indiquen (JSON/XML, push o consulta periódica) y a sus condiciones de uso, límites de consultas y requisitos de marca y juego responsable. No realizamos apuestas automáticas.
>
> ¿Podrían indicarnos la persona de contacto o el procedimiento para solicitarlo?
>
> Saludos cordiales,
> [Nombre] · [Empresa] · [Teléfono] · [Correo]

Kontaktweg: über den Support/Chat auf aposta.la (Zendesk) nach dem Ansprechpartner für **afiliados / partners / datos** fragen.
