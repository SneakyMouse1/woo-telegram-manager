# WordPress Brand Sale Integration

Companion WordPress plugin/snippet for the WooCommerce Telegram Manager's `/discounts` feature.

It provides:
1. Dynamic WooCommerce pricing calculation for products belonging to promotional brands during an active sale window.
2. Version-keyed cache invalidation for LiteSpeed Cache, WP Rocket, and WooCommerce variation transients.
3. Protected REST API endpoints (`/wp-json/wc-brand-sale/v1`) for managing brand sales and querying brand terms.

---

## Installation Options

### Option A: Must-Use Plugin (Recommended)
Must-Use (MU) plugins are loaded automatically by WordPress and cannot be accidentally deactivated or removed from the admin panel.

1. Navigate to your WordPress `wp-content/mu-plugins/` directory (create the `mu-plugins` folder if it doesn't exist).
2. Copy [`wc-brand-sale.php`](file:///Users/simonsmyslov/Desktop/WorkProjects/woo-telegram-manager/wordpress/wc-brand-sale.php) into `wp-content/mu-plugins/wc-brand-sale.php`.
3. Check **WordPress Admin > Plugins > Must-Use** to verify it is active.

### Option B: Standard Plugin
1. Create a folder `wp-content/plugins/wc-brand-sale/`.
2. Place [`wc-brand-sale.php`](file:///Users/simonsmyslov/Desktop/WorkProjects/woo-telegram-manager/wordpress/wc-brand-sale.php) inside as `wp-content/plugins/wc-brand-sale/wc-brand-sale.php`.
3. Activate the plugin in **WordPress Admin > Plugins**.

### Option C: Code Snippets Plugin
If your site uses the **Code Snippets** plugin:
1. Go to **Snippets > Add New**.
2. Title: `WooCommerce Brand Sale REST API & Dynamic Pricing`.
3. Paste the contents of [`wc-brand-sale.php`](file:///Users/simonsmyslov/Desktop/WorkProjects/woo-telegram-manager/wordpress/wc-brand-sale.php) (excluding the opening `<?php` tag).
4. Select **Run snippet everywhere** and click **Save Changes and Activate**.

---

## Configuration & Credentials

The Telegram bot connects to WordPress using an **Application Password**:

1. In WordPress Admin, navigate to **Users > Profile** (or edit an administrator user account with `manage_woocommerce` capability).
2. Scroll to the **Application Passwords** section.
3. Enter a name (e.g. `Telegram Bot Manager`) and click **Add New Application Password**.
4. Copy the generated password (e.g. `xxxx xxxx xxxx xxxx xxxx xxxx`).
5. In your `.env` file for the bot, configure:
   ```env
   WP_URL=https://shop.example.com
   WP_USER=admin_username
   WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
   ```

---

## Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/wp-json/wc-brand-sale/v1/brand-sale` | Returns current sale status, dates, and brand discounts. |
| `PUT` | `/wp-json/wc-brand-sale/v1/brand-sale` | Replaces the entire sale configuration `{ start, end, discounts }`. |
| `DELETE` | `/wp-json/wc-brand-sale/v1/brand-sale` | Ends the active sale immediately (`end = now - 1`). |
| `GET` | `/wp-json/wc-brand-sale/v1/brands` | Returns list of brands across supported taxonomies. |
