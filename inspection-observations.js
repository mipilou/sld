// Les propositions décrivent l'élément. Aucun constat n'est présélectionné.
export function observationOptions(label = "") {
  const value = label.toLowerCase();
  const groups = [
    [/chauffe[- ]?eau/, ["Fonctionne, eau chaude disponible", "Absence d’eau chaude", "Fuite visible", "Fixation à reprendre", "Non testé"]],
    [/climatisation|ventilateur|hotte|ventilation|aération/, ["Fonctionne normalement", "Bruit anormal", "Débit insuffisant", "Grille encrassée", "Ne fonctionne pas", "Non testé"]],
    [/clé|clés|badge/, ["Complet et testé", "Jeu incomplet", "Clé manquante", "Badge non fonctionnel", "Non testé"]],
    [/miroir|vitrage|vitre/, ["Intact", "Rayures", "Fissure", "Cassé", "Fixation instable"]],
    [/fenêtre|volet|rideau/, ["Ouverture et fermeture normales", "Fermeture difficile", "Joint détérioré", "Vitrage fissuré", "Mécanisme bloqué"]],
    [/placard|étagère|tablette|charnière|rangement/, ["Complet, fixé et fonctionnel", "Porte mal alignée", "Charnière desserrée", "Tablette manquante", "Traces d’humidité", "Fixation instable"]],
    [/porte|serrure|verrou|poignée/, ["Fonctionne normalement", "Ferme difficilement", "Poignée desserrée", "Serrure bloquée", "Rayures ou chocs", "Élément manquant"]],
    [/prise|interrupteur|luminaire|lumineux|douille|éclairage/, ["Testé, fonctionne", "Ne fonctionne pas", "Cache manquant", "Fixation desserrée", "Ampoule manquante", "Non testé"]],
    [/wc|w\.c|cuvette|abattant|chasse/, ["Fonctionne, sans fuite visible", "Chasse défectueuse", "Fuite visible", "Abattant cassé", "Évacuation lente", "Traces de calcaire", "Non testé"]],
    [/robinet|évier|lavabo|douche|flexible|pommeau|eau|siphon|joint|évacuation/, ["Fonctionne, sans fuite visible", "Fuite visible", "Évacuation lente ou bouchée", "Joint à remplacer", "Traces de calcaire", "Fissure", "Non testé"]],
    [/propreté/, ["Propre", "Nettoyage à prévoir", "Salissures importantes", "Déchets à évacuer", "Odeur à signaler"]],
    [/mur|plafond|peinture|faïence/, ["Propre, sans défaut visible", "Traces ou taches", "Fissures", "Peinture écaillée", "Trous à reboucher", "Humidité ou moisissures"]],
    [/sol|plinthe|plan de travail|crédence/, ["Intact", "Rayures", "Carreau fissuré", "Élément décollé", "Traces ou taches", "Gonflement ou humidité"]],
    [/garde-corps/, ["Fixation stable", "Corrosion", "Fixation desserrée", "Élément cassé ou manquant"]]
  ];
  return [...(groups.find(([test]) => test.test(value))?.[1] || ["Sans défaut visible", "Usure visible", "Endommagé", "Élément manquant", "Non testé"]), "Autre constat à préciser"];
}
export const observationText = item => [item?.observation, item?.note].filter(Boolean).join(" — ");
