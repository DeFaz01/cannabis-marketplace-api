import { connect } from "framer-api"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 250

function normalizeStatus(value) {
  const status = String(value ?? "").trim().toLowerCase()

  if (status.includes("sold")) return "sold"
  if (status.includes("removed")) return "removed"
  if (status.includes("inactive")) return "inactive"
  if (status.includes("pending")) return "pending"

  return "active"
}

function getField(fieldData, names) {
  if (!fieldData) return null

  for (const name of names) {
    if (fieldData[name] !== undefined) {
      return fieldData[name]
    }
  }

  return null
}

export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json")
  response.setHeader("Cache-Control", "no-store")

  if (request.method !== "GET") {
    return response.status(405).json({
      error: "Method not allowed",
    })
  }

  const suppliedApiKey = request.headers["x-api-key"]

  if (
    !process.env.M9E_API_KEY ||
    suppliedApiKey !== process.env.M9E_API_KEY
  ) {
    return response.status(401).json({
      error: "Unauthorized",
    })
  }

  const page = Math.max(
    Number.parseInt(request.query.page || "1", 10),
    1
  )

  const requestedLimit = Number.parseInt(
    request.query.limit || String(DEFAULT_LIMIT),
    10
  )

  const limit = Math.min(
    Math.max(requestedLimit, 1),
    MAX_LIMIT
  )

  let updatedSince = null

  if (request.query.updated_since) {
    updatedSince = new Date(request.query.updated_since)

    if (Number.isNaN(updatedSince.getTime())) {
      return response.status(400).json({
        error:
          "updated_since must be a valid ISO 8601 timestamp",
      })
    }
  }

  let framer

  try {
    framer = await connect(
      process.env.FRAMER_PROJECT_URL,
      process.env.FRAMER_API_KEY
    )

    const collections = await framer.getCollections()

    const marketplaceCollection = collections.find(
      (collection) =>
        collection.name ===
        process.env.FRAMER_COLLECTION_NAME
    )

    if (!marketplaceCollection) {
      return response.status(500).json({
        error: "Marketplace CMS collection not found",
        configured_collection:
          process.env.FRAMER_COLLECTION_NAME,
        available_collections: collections.map(
          (collection) => ({
            id: collection.id,
            name: collection.name,
          })
        ),
      })
    }

    const items = await marketplaceCollection.getItems()

    const listings = items
      .filter((item) => !item.draft)
      .map((item) => {
        const fields = item.fieldData || {}

        const rawStatus = getField(fields, [
          "Status",
          "status",
        ])

        return {
          sku: getField(fields, ["SKU", "sku"]),
          slug: item.slug || null,
          item: getField(fields, ["Item", "item"]),
          image: getField(fields, ["Image", "image"]),
          image_alt: getField(fields, [
            "Image: Alt",
            "Image Alt",
            "image-alt",
          ]),
          price: getField(fields, ["Price", "price"]),
          location: getField(fields, [
            "Location",
            "location",
          ]),
          shipping: getField(fields, [
            "Shipping",
            "shipping",
          ]),
          facility_type: getField(fields, [
            "Facility Type",
            "facility-type",
          ]),
          equipment_type: getField(fields, [
            "Equipment Type",
            "equipment-type",
          ]),
          state: getField(fields, ["State", "state"]),
          status: normalizeStatus(rawStatus),
          status_raw: rawStatus,
          status_2: getField(fields, [
            "Status 2",
            "status-2",
          ]),
          tag: getField(fields, ["Tag", "tag"]),
          status_rent_sale: getField(fields, [
            "Status Rent/Sale",
            "status-rent-sale",
          ]),
          description: getField(fields, [
            "Description",
            "description",
          ]),
          seller: getField(fields, [
            "Seller",
            "seller",
          ]),
          product_video: getField(fields, [
            "Product Video",
            "product-video",
          ]),
          updated_at: item.updatedAt || null,
          source_url: item.slug
            ? `https://www.cannabisexpertsmarketplace.net/${item.slug}`
            : null,
        }
      })
      .filter((listing) => listing.sku)
      .filter((listing) => {
        if (!updatedSince) return true
        if (!listing.updated_at) return false

        return (
          new Date(listing.updated_at).getTime() >
          updatedSince.getTime()
        )
      })

    const startIndex = (page - 1) * limit
    const paginatedListings = listings.slice(
      startIndex,
      startIndex + limit
    )

    return response.status(200).json({
      data: paginatedListings,
      pagination: {
        page,
        limit,
        max_page_size: MAX_LIMIT,
        total_records: listings.length,
        total_pages: Math.ceil(
          listings.length / limit
        ),
        has_more:
          startIndex + limit < listings.length,
      },
      generated_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Marketplace API error:", error)

    return response.status(500).json({
      error: "Unable to retrieve marketplace listings",
      message:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    })
  } finally {
    if (framer) {
      await framer.disconnect()
    }
  }
}
