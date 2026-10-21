import { createApp } from "./app";
import { startMarketplaceScheduler } from "./modules/marketplace-integrations/marketplace-refresh";

const port = Number(process.env.PORT ?? 3001);
createApp().listen(port, () => {
  console.log(`API running on ${port}`);
  if (startMarketplaceScheduler()) console.log("Atualização automática do eBay ligada");
});
