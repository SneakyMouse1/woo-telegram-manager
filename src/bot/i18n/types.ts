export type SupportedLanguage = 'ru' | 'en' | 'es';

export interface OrderTranslations {
  // Statuses
  statusProcessing: string;
  statusCompleted: string;
  statusOnHold: string;
  statusPending: string;
  statusCancelled: string;
  statusRefunded: string;
  statusFailed: string;

  // Order Detail & Notification
  orderTitle: string;
  newOrderBanner: string;
  b2bBadge: string;
  b2cBadge: string;
  customer: string;
  company: string;
  phone: string;
  email: string;
  location: string;
  paymentAndShipping: string;
  paymentMethod: string;
  shipping: string;
  freeShipping: string;
  invoice: string;
  fee: string;
  netAmount: string;
  orderComposition: string;
  sku: string;
  pcs: string;
  customerNote: string;
  totalToPay: string;
  totalShort: string;
  inclTax: string;
  store: string;

  // Order Buttons
  btnOrders: string;
  btnProcessing: string;
  btnCompleted: string;
  btnOnHold: string;
  btnRefresh: string;
  btnOrdersList: string;
  btnBackToList: string;
  btnWPAdmin: string;

  // Orders list
  ordersListTitle: string;
  selectOrderHint: string;
  noOrders: string;
  loadingOrders: string;
  statusChanged: string;
  orderLoading: string;
  ordersPage: string;
}

export interface ReportTranslations {
  reportsTitle: string;
  period: string;
  period7Days: string;
  periodMonth: string;
  period3Months: string;
  period6Months: string;
  periodYtd: string;
  periodLastYear: string;
  periodAllTime: string;
  period1Year: string;
  grossSales: string;
  netSales: string;
  totalOrders: string;
  itemsSold: string;
  avgOrder: string;
  taxes: string;
  shippingTotal: string;
  dailyDynamics: string;
  monthlyDynamics: string;
  ordersShort: string;
  loadingAnalytics: string;
  noData: string;

  // Top Customers
  topCustomersTitle: string;
  spent: string;
  ordersCount: string;
  aov: string;
  lastOrder: string;
  noCustomers: string;
  chooseYearPrompt: string;
  yearFormat: string;

  // Buttons
  btnReports: string;
  btnSalesReport: string;
  btnTopCustomers: string;
  btnChooseYear: string;

  // Dynamic formatting & months
  months: string[];
  grossLabel: string;
}

export interface BrandTranslations {
  brandsCatalogTitle: string;
  totalBrands: string;
  page: string;
  selectBrandHint: string;
  brandLabel: string;
  productsCount: string;
  inStock: string;
  outOfStock: string;
  lowStock: string;
  backorder: string;
  price: string;
  stock: string;
  noProducts: string;
  errorLoadingBrands: string;
  searchResultsTitle: string;
  noSearchResults: string;
  searching: string;
  productsFound: string;
  brandsFound: string;
  viewProduct: string;
  paginationOf: string;

  // Buttons
  btnBrands: string;
  btnAllBrands: string;
  btnRefreshList: string;
}

export interface PairingTranslations {
  pairingTitle: string;
  pairingOneTimePin: string;
  pairingTapToCopy: string;
  pairingExpiresIn: string;
  pairingInstructionsTitle: string;
  pairingStep1: string;
  pairingStep2: string;
  pairingStep3: (code: string) => string;
  btnNewPin: string;

  // Success connection messages
  storeConnectedBanner: (name: string, domain: string) => string;
  storeConnectedSuccess: string;
}

export interface CommonTranslations {
  btnLanguage: string;
  btnPrev: string;
  btnNext: string;
  btnBack: string;

  chooseLanguage: string;
  languageChanged: string;
  welcomeConnected: string;
  welcomeHelp: string;
  welcomeTitle: string;
  welcomeSelect: string;
  guest: string;
  noStore: string;
  helpText: string;

  // Command descriptions
  cmdStart: string;
  cmdOrders: string;
  cmdBrands: string;
  cmdReports: string;
  cmdHelp: string;
  cmdLanguage: string;
  // Multi-store and Selection UI
  selectStore: string;
  btnSwitchStore: string;
  searchExpired: string;
  searchStorePrompt: (query: string) => string;
  noStoresAvailable: string;

  // Invites and User Management
  inviteUsage: (stores: string) => string;
  inviteLabelRequired: string;
  inviteStoreNotFound: (store: string, stores: string) => string;
  inviteCreated: (store: string, label: string, url: string) => string;
  inviteFailed: (err: string) => string;
  inviteLimitReached: string;
  inviteStoreInactive: string;
  inviteActivatedAdminNotify: (label: string, store: string, username: string, id: string) => string;
  usersTitle: string;
  usersNoMembers: string;
  userActive: string;
  userDisabled: string;
  userAdmin: string;
  revokeUsage: string;
  revokeChatIdNumeric: string;
  revokeCannotSelf: string;
  revokeUserNotFound: (id: string) => string;
  revokeUserSuccess: (id: string) => string;
  revokeStoreNotFound: (store: string) => string;
  revokeNoMembership: (id: string, store: string) => string;
  revokeStoreSuccess: (id: string, store: string) => string;
  adminDefaultLabel: string;
  withoutUsername: string;
}

export interface ErrorTranslations {
  authErrorExpired: string;
  errorPrefix: string;
  storeNotFoundOrInactive: (name: string) => string;
  noAccessibleStores: string;
  accessDeniedNotMember: string;
  userInactiveOrNotFound: string;
  storeInactive: string;
}

export type TranslationDictionary = OrderTranslations &
  ReportTranslations &
  BrandTranslations &
  PairingTranslations &
  CommonTranslations &
  ErrorTranslations;
