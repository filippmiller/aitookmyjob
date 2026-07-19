/**
 * One-shot i18n parity patch for aitj-z8q.19 (admin + a11y keys).
 * Safe to re-run — merges keys without removing existing translations.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "public", "i18n");

const enExtra = {
  skipToContent: "Skip to content",
  privacyExport: "Export my data",
  privacyExportOk: "Export ready.",
  deleteAccount: "Delete account",
  deleteAccountConfirm: "Type DELETE to confirm"
};

const byLang = {
  en: enExtra,
  ru: {
    ctaAuth: "Открыть вход",
    adminToken: "Админ-токен",
    loadAdmin: "Загрузить обзор",
    loadQueue: "Загрузить очередь модерации",
    moderationQueueTitle: "Очередь модерации",
    queueEmpty: "Очередь пуста.",
    moderationAction: "Действие",
    moderationReason: "Причина",
    approve: "Одобрить",
    reject: "Отклонить",
    adminActionRun: "Выполнить",
    adminActionOk: "Действие модерации применено.",
    adminActionFail: "Не удалось выполнить действие модерации.",
    sanctionsTitle: "Санкции",
    sanctionTargetUser: "ID пользователя",
    sanctionType: "Тип санкции",
    sanctionReason: "Причина санкции",
    sanctionDurationDays: "Срок (дни)",
    sanctionSubmit: "Применить санкцию",
    sanctionOk: "Санкция применена.",
    sanctionFail: "Не удалось применить санкцию.",
    skipToContent: "Перейти к содержимому",
    privacyExport: "Экспорт данных",
    privacyExportOk: "Экспорт готов.",
    deleteAccount: "Удалить аккаунт",
    deleteAccountConfirm: "Введите DELETE для подтверждения"
  },
  de: {
    ctaAuth: "Anmeldung öffnen",
    adminToken: "Admin-Token",
    loadAdmin: "Übersicht laden",
    loadQueue: "Moderationswarteschlange laden",
    moderationQueueTitle: "Moderationswarteschlange",
    queueEmpty: "Warteschlange ist leer.",
    moderationAction: "Aktion",
    moderationReason: "Grund",
    approve: "Genehmigen",
    reject: "Ablehnen",
    adminActionRun: "Aktion ausführen",
    adminActionOk: "Moderationsaktion angewendet.",
    adminActionFail: "Moderationsaktion fehlgeschlagen.",
    sanctionsTitle: "Sanktionen",
    sanctionTargetUser: "Ziel-Benutzer-ID",
    sanctionType: "Sanktionstyp",
    sanctionReason: "Sanktionsgrund",
    sanctionDurationDays: "Dauer (Tage)",
    sanctionSubmit: "Sanktion anwenden",
    sanctionOk: "Sanktion angewendet.",
    sanctionFail: "Sanktion konnte nicht angewendet werden.",
    skipToContent: "Zum Inhalt springen",
    privacyExport: "Daten exportieren",
    privacyExportOk: "Export bereit.",
    deleteAccount: "Konto löschen",
    deleteAccountConfirm: "DELETE eingeben zur Bestätigung"
  },
  fr: {
    ctaAuth: "Ouvrir la connexion",
    adminToken: "Jeton admin",
    loadAdmin: "Charger l'aperçu",
    loadQueue: "Charger la file de modération",
    moderationQueueTitle: "File de modération",
    queueEmpty: "La file est vide.",
    moderationAction: "Action",
    moderationReason: "Motif",
    approve: "Approuver",
    reject: "Rejeter",
    adminActionRun: "Exécuter",
    adminActionOk: "Action de modération appliquée.",
    adminActionFail: "Échec de l'action de modération.",
    sanctionsTitle: "Sanctions",
    sanctionTargetUser: "ID utilisateur cible",
    sanctionType: "Type de sanction",
    sanctionReason: "Motif de la sanction",
    sanctionDurationDays: "Durée (jours)",
    sanctionSubmit: "Appliquer la sanction",
    sanctionOk: "Sanction appliquée.",
    sanctionFail: "Impossible d'appliquer la sanction.",
    skipToContent: "Aller au contenu",
    privacyExport: "Exporter les données",
    privacyExportOk: "Export prêt.",
    deleteAccount: "Supprimer le compte",
    deleteAccountConfirm: "Saisissez DELETE pour confirmer"
  },
  es: {
    ctaAuth: "Abrir acceso",
    adminToken: "Token de admin",
    loadAdmin: "Cargar resumen",
    loadQueue: "Cargar cola de moderación",
    moderationQueueTitle: "Cola de moderación",
    queueEmpty: "La cola está vacía.",
    moderationAction: "Acción",
    moderationReason: "Motivo",
    approve: "Aprobar",
    reject: "Rechazar",
    adminActionRun: "Ejecutar acción",
    adminActionOk: "Acción de moderación aplicada.",
    adminActionFail: "Falló la acción de moderación.",
    sanctionsTitle: "Sanciones",
    sanctionTargetUser: "ID de usuario objetivo",
    sanctionType: "Tipo de sanción",
    sanctionReason: "Motivo de la sanción",
    sanctionDurationDays: "Duración (días)",
    sanctionSubmit: "Aplicar sanción",
    sanctionOk: "Sanción aplicada.",
    sanctionFail: "No se pudo aplicar la sanción.",
    skipToContent: "Saltar al contenido",
    privacyExport: "Exportar datos",
    privacyExportOk: "Exportación lista.",
    deleteAccount: "Eliminar cuenta",
    deleteAccountConfirm: "Escribe DELETE para confirmar"
  }
};

for (const [lang, extra] of Object.entries(byLang)) {
  const p = path.join(dir, `${lang}.json`);
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  Object.assign(data, extra);
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
  console.log(lang, "keys", Object.keys(data).length);
}
