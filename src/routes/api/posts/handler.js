import { pb } from "../../../lib/pb";

export async function GET({ url }) {
    const page = Number(url.searchParams.get("page") || 1);
    const limit = Number(url.searchParams.get("limit") || 20);

    try {
        const data = await pb.collection("posts").getList(page, limit, {
            sort: "-created"
        });

        return new Response(JSON.stringify({
            page: data.page,
            totalPages: data.totalPages,
            items: data.items
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500
        });
    }
}
