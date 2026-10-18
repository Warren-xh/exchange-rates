/* 各国物价参考数据（Numbeo，2026 年 10 月抓取）。
   prices 为当地货币；index 为 Numbeo 指数（纽约 = 100）。
   更新方法：改这里的数字和 updated 日期，然后 node build.mjs。 */
const PRICES = {
  source: "Numbeo",
  sourceUrl: "https://www.numbeo.com/cost-of-living/",
  baseline: "CN",
  byCurrency: { EUR: "IE", THB: "TH", VND: "VN", IDR: "ID", MAD: "MA", JPY: "JP" },
  groups: [
    { name: "餐饮", items: [
      ["meal_cheap", "平价餐厅一餐", ""],
      ["meal_mid2", "中档餐厅两人套餐", "三道菜"],
      ["mcmeal", "麦当劳套餐", ""],
      ["cappuccino", "卡布奇诺", "常规杯"],
      ["beer", "生啤", "1 品脱，餐厅"],
    ] },
    { name: "超市", items: [
      ["water", "瓶装水", "1.5 L"],
      ["coke", "可乐", "355 ml"],
      ["milk", "牛奶", "1 L"],
      ["bread", "白面包", "454 g"],
      ["rice", "大米", "454 g"],
      ["eggs", "鸡蛋", "12 个"],
    ] },
    { name: "交通", items: [
      ["ticket", "公交 / 地铁单程票", ""],
      ["taxi", "出租车起步价", ""],
      ["gas", "汽油", "1 L"],
    ] },
    { name: "居住与收入（每月）", items: [
      ["rent", "市中心一居室租金", ""],
      ["utilities", "水电燃气", "85 ㎡"],
      ["internet", "宽带", ""],
      ["salary", "平均税后月薪", ""],
    ] },
  ],
  countries: {
    CN: { name: "中国", currency: "CNY", updated: "2026-10-18", indexPeriod: "2026 年年中",
      index: { col: 30.7, rent: 9.5, groceries: 36.3, restaurant: 21.1, lpp: 94.2 },
      prices: { meal_cheap: 20, meal_mid2: 150, mcmeal: 35, beer: 7, cappuccino: 20.01, coke: 3.32, water: 3.83, milk: 11.86, bread: 10.04, rice: 2.9, eggs: 10.56, ticket: 2, taxi: 10, gas: 8.57, utilities: 368.01, internet: 72.93, rent: 2610.81, salary: 7204.67 } },
    IE: { name: "爱尔兰", note: "欧元区各国物价差别大，这里以爱尔兰为例", currency: "EUR", updated: "2026-10-15", indexPeriod: "2026 年年中",
      index: { col: 70.8, rent: 41.4, groceries: 70.6, restaurant: 76.3, lpp: 113.0 },
      prices: { meal_cheap: 20, meal_mid2: 80, mcmeal: 11, beer: 6, cappuccino: 3.98, coke: 2.51, water: 1.82, milk: 1.41, bread: 1.81, rice: 0.77, eggs: 3.95, ticket: 2, taxi: 5, gas: 1.82, utilities: 220.66, internet: 47.13, rent: 1574.71, salary: 3061.61 } },
    TH: { name: "泰国", currency: "THB", updated: "2026-10-16", indexPeriod: "2026 年年中",
      index: { col: 36.8, rent: 12.8, groceries: 43.5, restaurant: 23.5, lpp: 41.0 },
      prices: { meal_cheap: 100, meal_mid2: 900, mcmeal: 220, beer: 75, cappuccino: 68.34, coke: 22.67, water: 16.93, milk: 60.11, bread: 41.69, rice: 19.44, eggs: 70.46, ticket: 30, taxi: 40, gas: 45.83, utilities: 2792.81, internet: 620.19, rent: 15728.21, salary: 18888.96 } },
    VN: { name: "越南", currency: "VND", updated: "2026-10-17", indexPeriod: "2026 年年中",
      index: { col: 26.9, rent: 9.6, groceries: 32.6, restaurant: 15.7, lpp: 40.5 },
      prices: { meal_cheap: 50000, meal_mid2: 500000, mcmeal: 119000, beer: 25000, cappuccino: 43417.05, coke: 13187.72, water: 12999.23, milk: 38759.16, bread: 23322.78, rice: 11036.41, eggs: 39495.89, ticket: 8453.7, taxi: 20000, gas: 23619.8, utilities: 1896833.8, internet: 241220.96, rent: 10685924.8, salary: 10670355.93 } },
    ID: { name: "印度尼西亚", currency: "IDR", updated: "2026-10-15", indexPeriod: "2026 年年中",
      index: { col: 24.7, rent: 7.8, groceries: 32.6, restaurant: 13.3, lpp: 28.5 },
      prices: { meal_cheap: 30000, meal_mid2: 210000, mcmeal: 58000, beer: 40000, cappuccino: 28166.21, coke: 8565.89, water: 7717.14, milk: 21537.73, bread: 18199.72, rice: 6954.23, eggs: 26992.55, ticket: 5000, taxi: 10000, gas: 14235.86, utilities: 1168057.64, internet: 351762.96, rent: 5315054.83, salary: 4725522.09 } },
    MA: { name: "摩洛哥", currency: "MAD", updated: "2026-10-18", indexPeriod: "2026 年初",
      index: { col: 31.4, rent: 8.3, groceries: 33.0, restaurant: 25.0, lpp: 45.6 },
      prices: { meal_cheap: 40, meal_mid2: 250, mcmeal: 68, beer: 40, cappuccino: 16.21, coke: 6.44, water: 5.7, milk: 8.59, bread: 5.43, rice: 7.59, eggs: 17.92, ticket: 5, taxi: 7, gas: 14.47, utilities: 385.01, internet: 367.16, rent: 3475.06, salary: 4517.79 } },
    JP: { name: "日本", currency: "JPY", updated: "2026-10-17", indexPeriod: "2026 年年中",
      index: { col: 47.6, rent: 13.6, groceries: 58.2, restaurant: 30.8, lpp: 107.3 },
      prices: { meal_cheap: 1000, meal_mid2: 5000, mcmeal: 800, beer: 500, cappuccino: 495.91, coke: 180.3, water: 136.99, milk: 231.31, bread: 213.34, rice: 345.66, eggs: 325.28, ticket: 220, taxi: 595, gas: 171.66, utilities: 24327.46, internet: 5214.89, rent: 88349.75, salary: 326871.72 } },
  },
};
if (typeof module !== "undefined") module.exports = PRICES;
