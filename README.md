# Delavnica

Preprost skupni pregled delovnih nalogov za delavnico. Ena vrstica predstavlja nalog, barvni gumbi pa dokumentacijo, material, razrez, obdelavo, sestavljanje, pakiranje, pločevino in odpremo.

## Najprej poglej

Odpri **predogled.html** z dvoklikom. To je samostojen interaktivni predogled z jasno označenimi izmišljenimi primeri. Deluje brez namestitve. Njegovi podatki ostanejo samo v tem brskalniku in se ne prenesejo v skupno aplikacijo. Prava aplikacija ob prvi namestitvi začne prazna.

## Vsakodnevna uporaba

- Vsak sodelavec se prijavi s svojim imenom in skupnim geslom delavnice. Ime je samoprijavljeno, brez preverjanja identitete; vsak prijavljeni lahko ustvarja in ureja vse naloge. Ločenih vlog vodje/delavca še ni.
- Klik na status odpre izbiro. Siva: čaka. Rumena: v delu ali naročeno. Zelena: zaključeno/pripravljeno. Rdeča: zastoj. Vijolična pri pločevini: na barvanju. »Ni potrebno« preskoči neuporabljeno fazo.
- Klik na oznako naloga odpre rok, odgovorno osebo, opombe, faze in zadnjih 300 sprememb. Spremembe v tem obrazcu potrdiš z »Shrani nalog«. Statusi v glavni tabeli se shranijo takoj po izbiri.
- Material: za naročiti / naročeno / pripravljeno / zastoj. Pločevina: ni potrebna / za naročiti / naročeno / čaka barvanje / na barvanju / pripravljena / zastoj.
- Fasado in pločevino odpremiš ločeno. »Fasada odšla« ne zaključi naloga, kadar pločevina še ni odpremljena. Status pločevine vključuje tudi »Čaka barvanje«. Filter »Delno odpremljeno« in oznaka pod nalogom pokažeta, kaj je že odšlo in kaj še čaka. »Za odpremo« pokaže naloge, kjer je vsaj en neodpremljen del pripravljen.
- Nalog se samodejno arhivira šele, ko sta odpremljeni fasada in vsa potrebna pločevina. Če pločevina ni potrebna, zadostuje odprema fasade. Ni brisanja nalogov; iz arhiva jih lahko vrneš med aktivne. Ob vrnitvi zaključenega naloga se odprema fasade ponastavi na »Čaka«. Ob ponovnem odprtju odpreme katerega od delov se nalog vrne med aktivne.
- Aktivni nalogi so urejeni po roku; zamujeni imajo opozorilo. Filtri: vsi aktivni, v delu, zastoji, za odpremo, arhiv. Iskanje pregleduje oznako, objekt, odgovorno osebo in opombe.
- Skupni pregled se osveži na 10 sekund, tudi ob vrnitvi v zavihek. Sočasne spremembe istega naloga se zaznajo: druga sprememba dobi opozorilo, da ponovno odpre nalog. Aplikacija ne prepiše tiho tujih sprememb. Ob izpadu povezave ne potrdi uspešnega shranjevanja.

## Namestitev na Hetzner

Potrebuješ obstoječa Docker in Caddy. Aplikacija uporablja svojo SQLite zbirko v trajnem Docker volume-u. Ne spreminja podatkov drugih aplikacij.

1. Prenesi kodo z `git clone https://github.com/damirjunuz/delavnica-app.git /opt/delavnica-app` ali razširi ZIP v isto mapo.
2. Na strežniku preveri, da je port 3111 prost (`ss -ltn | rg ':3111'`; če rg manjka, uporabi grep) in da omrežje `n8n_n8n-network` obstaja (`docker network ls`). Če ima Caddy drugo omrežje, popravi `.env`.
Privzeti lokalni port je **3111**; z `APP_PORT` v `.env` ga lahko spremeniš. Vrata 3110 na obstoječem strežniku uporablja solarna aplikacija. Caddy se poveže neposredno na notranji port 3100 v Docker omrežju.

3. Pripravi nastavitve:

```bash
cd /opt/delavnica-app
cp .env.example .env
chmod 600 .env
nano .env
```

Nastavi `APP_PASSWORD` z najmanj 12 znaki. `APP_ORIGIN` mora biti natančen zunanji naslov, brez zaključne poševnice, npr. `https://delavnica.dservis.si`. Primer domene še ni registriran ali nastavljen s tem paketom. Če geslo vsebuje znake s pomenom v Compose (.env), kot so `$` ali `#`, ovij celotno vrednost v enojne narekovaje.

4. Zaženi in preveri:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3111/health
```

5. Pri ponudniku DNS usmeri izbrano poddomeno na IP strežnika. V obstoječi `/opt/n8n/Caddyfile` **dodaj** ta blok in ohrani vse ostale:

```caddy
delavnica.dservis.si {
    reverse_proxy delavnica-app:3100
}
```

6. Preveri in ponovno naloži Caddy:

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

7. Odpri izbrani HTTPS naslov, prijavi se, dodaj prvi nalog in preveri spremembo še na drugem telefonu ali računalniku. Vsi uporabljajo isti naslov. Za prijavo se uporablja piškotek HttpOnly/SameSite; v produkciji zahteva HTTPS.

Če se aplikacija ne zažene: `docker compose logs --tail=80 delavnica-app`. Najpogostejši vzroki so manjkajoče geslo, napačen APP_ORIGIN, zaseden port ali napačno Docker omrežje.

## Varnostne kopije in posodobitve

Podatki so v volume-u `delavnica-app_delavnica_data`, če je projekt zagnan v mapi z zgornjim imenom in brez preimenovanja Compose projekta. Spodnji postopek uporablja dejansko pripeti `/data`, zato imena volume-a ne predpostavlja.

Preprost dosleden backup med ustavljeno aplikacijo (datoteka vsebuje tudi prijavne seje, zato jo varuj):

```bash
cd /opt/delavnica-app
mkdir -p backups
chmod 700 backups
docker compose stop delavnica-app
docker compose cp delavnica-app:/data "backups/data-$(date +%Y%m%d-%H%M%S)"
docker compose start delavnica-app
```

Preveri uspešen izpis kopiranja in prisotnost datotek v `backups` ter kopijo shrani tudi zunaj strežnika. Kopira se celotna mapa z SQLite zbirko in morebitnima WAL/SHM datotekama. Obnovitev izvajaj le ob ustavljeni aplikaciji; pred zamenjavo podatkov shrani še trenutno kopijo in ohrani lastništvo UID 10001. Ne uporabljaj `docker compose down -v`, ker izbriše podatke.

Pri posodobitvi ohrani `.env` in volume; po kopiji nove kode uporabi `docker compose up -d --build`. Menjava gesla in ponovni zagon prekličeta stare prijave.

## Lokalni preizkus in preverjanje

Brez dodatnih Python knjižnic; Python 3.12 ali novejši:

```bash
python3 -m unittest discover -s tests -v
APP_PASSWORD='lokalno-testno-geslo' APP_ORIGIN=http://localhost:3111 DATA_DIR=./data PORT=3111 python3 server.py
```

Nato odpri `http://localhost:3111` (ne IP naslova, ker se mora izvor ujemati). Lokalni podatki se shranijo v `data`. Strežnik uporablja standardni Python HTTP strežnik za manjšo interno delavnico, za Caddyjem; ni namenjen velikim javnim obremenitvam.

Prva različica ne vsebuje nalaganja dokumentov, e-pošte, n8n integracij, zalog ali različnih uporabniških pravic. Namenjena je hitremu skupnemu označevanju poteka dela.

## Preverjanje tega paketa

Uspešnih je devet integracijskih preizkusov, vključno z ločeno odpremo, odpremo pločevine pred fasado ter nadgradnjo starih nalogov: prijava/odjava in preverjanje izvora, skupni podatki in zgodovina, sočasno urejanje brez prepisovanja, odprema/arhiv/vrnitev, zavrnitev neveljavnih podatkov ter ohranitev podatkov po ponovnem zagonu. Preverjena sta tudi sintaksa JavaScripta in prevajanje Pythona. Vizualnega preizkusa v brskalniku v pripravljalnem okolju ni bilo mogoče dokončati. Docker gradnja in namestitev na ciljnem Hetzner strežniku še nista preverjeni.

## Nadgradnja na ločeno odpremo

Ob zagonu se obstoječim nalogom samodejno doda odprema pločevine. Aktivni nalogi s potrebno pločevino dobijo status »Čaka«. Že odpremljeni arhivirani nalogi ostanejo zaključeni (stara enotna odprema se razume kot odprema obeh delov). Pred nadgradnjo naredi varnostno kopijo podatkov. Uporabi `git pull --ff-only` in `docker compose up -d --build`.
