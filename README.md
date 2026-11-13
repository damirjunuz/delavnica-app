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

Uspešnih je petnajst integracijskih preizkusov, vključno z ločeno odpremo, odpremo pločevine pred fasado ter nadgradnjo starih nalogov: prijava/odjava in preverjanje izvora, skupni podatki in zgodovina, sočasno urejanje brez prepisovanja, odprema/arhiv/vrnitev, zavrnitev neveljavnih podatkov ter ohranitev podatkov po ponovnem zagonu. Preverjena sta tudi sintaksa JavaScripta in prevajanje Pythona. Vizualnega preizkusa v brskalniku v pripravljalnem okolju ni bilo mogoče dokončati. Docker gradnja in namestitev na ciljnem Hetzner strežniku še nista preverjeni.

## Nadgradnja na ločeno odpremo

Ob zagonu se obstoječim nalogom samodejno doda odprema pločevine. Aktivni nalogi s potrebno pločevino dobijo status »Čaka«. Že odpremljeni arhivirani nalogi ostanejo zaključeni (stara enotna odprema se razume kot odprema obeh delov). Pred nadgradnjo naredi varnostno kopijo podatkov. Uporabi `git pull --ff-only` in `docker compose up -d --build`.

## Barvana in surova pločevina na istem nalogu

V pregledu sta pri pločevini in njeni odpremi dve vrstici: **Barvana** in **Surova**. Obe vrsti sta lahko potrebni na istem nalogu. Vsaka ima svoj status in ločeno odpremo. Nepotrebno vrsto označi z »Ni potrebno«.

- Barvana: ni potrebna / za naročiti / naročeno / čaka barvanje / na barvanju / pripravljena / zastoj.
- Surova: ni potrebna / za naročiti / naročeno / v pripravi / pripravljena / zastoj. Barvanja pri njej ni.
- Primer: fasada in surova pločevina sta že odšli, barvana pa še čaka barvanje. Nalog ostane med aktivnimi in delno odpremljenimi.
- Arhiviranje zahteva odpremo fasade in obeh vrst pločevine, ki sta označeni kot potrebni.

Ob nadgradnji ostanejo dosedanji statusi pločevine pod »Barvana«. Nova surova pločevina je privzeto »Ni potrebno«; obstoječih podatkov ne razvrščamo samodejno po vrsti. Če se dosedanji status nanaša na surovo pločevino, ga uporabnik prenese na surovo vrstico in barvano po potrebi označi kot nepotrebno. Že arhivirani nalogi ostanejo arhivirani.

## Ročne opombe in drobni material

Klikni oznako naloga. V polje **Opombe / kaj manjka** vpiši navodila ali dogovor, v ločeno večvrstično polje **Drobni material** pa vijake, sidra, tesnila in količine. Primer: »Vijaki M8 – 24 kos; sidra – 12 kos«. Obe polji omogočata do 4000 znakov; vpis potrdi z **Shrani nalog**.

Kratka vsebina obeh polj je vidna pod oznako naloga v glavni tabeli, celoten zapis pa v podrobnostih. Iskalnik pregleduje tudi drobni material. Spremembe se zabeležijo v zgodovini z imenom in časom. Obstoječe opombe ostanejo ohranjene, novi drobni material je pri starih nalogih prazen. Vpis drobnega materiala ne spremeni barvnega statusa naročila materiala in ne vodi zaloge.

## Sidra in priprava v skladišču

V podrobnostih naloga je ločen ročni seznam **Sidra** (tip, oznaka, količina), poleg seznama **Drobni material**. Oba seznama sta v glavnem pregledu v svojih stolpcih. Skladiščnik se prijavi s svojim imenom in klikne **Čaka pripravo**; status se takoj spremeni v zeleno **✓ Pripravljeno**. Dodatno shranjevanje ali odpiranje naloga za ta klik ni potrebno. Ponoven klik vrne stanje na »Čaka pripravo«.

V podrobnostih je mogoče izbrati tudi »Ni potrebno«. Spremembe priprave so zapisane v zgodovini z imenom in časom. Če se že potrjeni seznam sider ali drobnega materiala spremeni, se njegova priprava samodejno vrne na »Čaka pripravo«, razen če uporabnik v istem shranjevanju izrecno spremeni tudi status. Pripravljenost fasade za odpremo upošteva pripravo obeh skupin. Pri nadgradnji stari aktivni nalogi dobijo »Čaka pripravo«, stari arhivirani pa »Ni potrebno«, da se zaključeni nalogi ohranijo.

## Pregled na telefonu

Na zaslonih do 900 px širine se projekti prikažejo kot kartice z nazivom, rokom, odgovorno osebo, stanjem in napredkom. Klik na projekt odpre pregled čez cel zaslon: izdelava, skladišče, barvana/surova pločevina, ločene odpreme in opombe. Na širšem računalniškem zaslonu ostane tabela.

Statusi v odprtem projektu se shranijo takoj. Skladiščnik lahko sidra in drobni material označi kot pripravljena z enim klikom. Gumb »Opombe, material in urejanje« odpre obrazec za besedila; tam spremembe potrdiš z »Shrani nalog«. Za vrnitev na seznam uporabi »← Projekti«. Filtri in iskanje veljajo tudi za kartice. Odprti projekt se ob osvežitvi posodobi brez prepisovanja neshranjenega obrazca za urejanje.

## Izdelava pločevine in oddani papirji

Barvana in surova pločevina imata novo stanje **V izdelavi**. Vsaka vrsta ima svoj datum **Oddani papirji**, ki se pokaže ob njenem statusu v tabeli in v mobilnem projektu. Klikni datum oziroma **＋ Vpiši datum**, izberi dejanski dan predaje dokumentacije ter potrdi **Shrani datum**. Datum je mogoče vpisati tudi v obrazcu za urejanje naloga.

Datum se ne ugiba iz dneva spremembe statusa; vpiše ga uporabnik in ostane shranjen tudi ob nadaljnjem barvanju ali odpremi. Za stare naloge ostane prazen, dokler ga uporabnik ne vpiše. Vsaka sprememba datuma se zabeleži v zgodovini. Vnos za barvano in surovo pločevino je ločen.

## Kape in podkape

Nova samostojna rubrika vsebuje ločena seznama **Kape** in **Podkape**. Vpišeš tip, mere, barvo in količino v podrobnostih naloga. Vsak seznam ima svojo pripravo: **Ni potrebno / Čaka pripravo / ✓ Pripravljeno**. V glavnem pregledu in mobilnem projektu se priprava potrdi z enim klikom; ponoven klik vrne čakanje.

Prazni novi in obstoječi nalogi imajo obe skupini označeni kot nepotrebni. Ko vpišeš seznam, se njegova skupina aktivira kot »Čaka pripravo«. Sprememba že potrjenega seznama zahteva ponovno pripravo. Statusa sta del pregleda pripravljenosti fasade za odpremo, spremembe pa so v zgodovini. Na telefonu je rubrika »Kape in podkape« v odprtem projektu, na računalniku v svojem stolpcu.
