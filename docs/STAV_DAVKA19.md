# Stav dávky 19

- Implementováno nezávislé SHA-512 ověření distribučního souboru Mermaid 8.9.2. Zdroj checksumu: cdnjs/SRIs, `mermaid/8.9.2.json`.
- Pro ABCjs 6.4.4 je přidána kontrola očekávaného rozhraní (ABCJS / renderAbc), nikoli ověření autentičnosti pomocí známého kontrolního součtu.
- Rollback při selhání zápisu se pokouší obnovit původní bajty u všech změněných souborů; výsledek nelze označit za atomický.
- Samotné originální distribuční soubory Mermaid a ABCjs do vydání nebyly přidány, jejich skutečné vykreslení tedy nebylo nově ověřeno.
- Reálné spuštění v Chrome/Edge přes `file://` zůstává neotestováno.
- Originální editor StackEdit `cledit` nadále není součástí projektu, editor je CodeMirror.
