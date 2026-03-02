import runtimeContext from '../../runtime-context.ts';
import { fetchActiveTabArticle } from '../../integrations/web-article/article-fetch';

const api = { fetchActiveTabArticle };
(runtimeContext as any).articleFetchService = api;

export { fetchActiveTabArticle };
export default api;
