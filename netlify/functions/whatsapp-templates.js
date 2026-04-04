// ============================================================
// WhatsApp Templates Management
// ============================================================
// Purpose: Manage WhatsApp message templates for 24h+ replies
// Endpoints:
//   GET  /api/whatsapp-templates - List all templates
//   GET  /api/whatsapp-templates/:id - Get single template
//   POST /api/whatsapp-templates - Create new template
//   PUT  /api/whatsapp-templates/:id - Update template
//   DELETE /api/whatsapp-templates/:id - Delete template
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getTemplateIdFromPath(path) {
  const parts = path.split('/');
  const templatesIndex = parts.findIndex(p => p === 'whatsapp-templates');
  if (templatesIndex >= 0 && parts.length > templatesIndex + 1) {
    return parts[templatesIndex + 1];
  }
  return null;
}

// ============================================================
// MAIN HANDLER
// ============================================================

export async function handler(event) {
  // Handle OPTIONS for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }
  
  const templateId = getTemplateIdFromPath(event.path);
  
  // ============================================================
  // GET /api/whatsapp-templates - List all templates
  // ============================================================
  if (event.httpMethod === 'GET' && !templateId) {
    try {
      const params = event.queryStringParameters || {};
      
      let query = supabase
        .from('whatsapp_templates')
        .select('*');
      
      // Filter by active status
      if (params.active !== undefined) {
        query = query.eq('is_active', params.active === 'true');
      }
      
      // Filter by category
      if (params.category) {
        query = query.eq('category', params.category);
      }
      
      // Sort by name
      query = query.order('name', { ascending: true });
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: data || []
        })
      };
      
    } catch (error) {
      console.error('Error fetching templates:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: error.message || 'Failed to fetch templates'
        })
      };
    }
  }
  
  // ============================================================
  // GET /api/whatsapp-templates/:id - Get single template
  // ============================================================
  if (event.httpMethod === 'GET' && templateId) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_templates')
        .select('*')
        .eq('id', templateId)
        .single();
      
      if (error || !data) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Template not found'
          })
        };
      }
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: data
        })
      };
      
    } catch (error) {
      console.error('Error fetching template:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: error.message || 'Failed to fetch template'
        })
      };
    }
  }
  
  // ============================================================
  // POST /api/whatsapp-templates - Create new template
  // ============================================================
  if (event.httpMethod === 'POST' && !templateId) {
    try {
      const body = JSON.parse(event.body || '{}');
      const { 
        name, 
        category, 
        language, 
        template_content,
        meta_template_id,
        is_active
      } = body;
      
      // Validate required fields
      if (!name || !category || !template_content) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'name, category, and template_content are required'
          })
        };
      }
      
      const { data, error } = await supabase
        .from('whatsapp_templates')
        .insert({
          name,
          category,
          language: language || 'en',
          template_content,
          meta_template_id,
          is_active: is_active !== undefined ? is_active : true
        })
        .select()
        .single();
      
      if (error) throw error;
      
      return {
        statusCode: 201,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: data,
          message: 'Template created successfully'
        })
      };
      
    } catch (error) {
      console.error('Error creating template:', error);
      
      // Handle unique constraint violation
      if (error.code === '23505') {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Template with this name already exists'
          })
        };
      }
      
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: error.message || 'Failed to create template'
        })
      };
    }
  }
  
  // ============================================================
  // PUT /api/whatsapp-templates/:id - Update template
  // ============================================================
  if (event.httpMethod === 'PUT' && templateId) {
    try {
      const body = JSON.parse(event.body || '{}');
      const { 
        name, 
        category, 
        language, 
        template_content,
        meta_template_id,
        meta_template_status,
        is_active
      } = body;
      
      const updateData = {};
      
      if (name !== undefined) updateData.name = name;
      if (category !== undefined) updateData.category = category;
      if (language !== undefined) updateData.language = language;
      if (template_content !== undefined) updateData.template_content = template_content;
      if (meta_template_id !== undefined) updateData.meta_template_id = meta_template_id;
      if (meta_template_status !== undefined) updateData.meta_template_status = meta_template_status;
      if (is_active !== undefined) updateData.is_active = is_active;
      
      if (Object.keys(updateData).length === 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'No valid update fields provided'
          })
        };
      }
      
      const { data, error } = await supabase
        .from('whatsapp_templates')
        .update(updateData)
        .eq('id', templateId)
        .select()
        .single();
      
      if (error) throw error;
      
      if (!data) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Template not found'
          })
        };
      }
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: data,
          message: 'Template updated successfully'
        })
      };
      
    } catch (error) {
      console.error('Error updating template:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: error.message || 'Failed to update template'
        })
      };
    }
  }
  
  // ============================================================
  // DELETE /api/whatsapp-templates/:id - Delete template
  // ============================================================
  if (event.httpMethod === 'DELETE' && templateId) {
    try {
      const { error } = await supabase
        .from('whatsapp_templates')
        .delete()
        .eq('id', templateId);
      
      if (error) throw error;
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Template deleted successfully'
        })
      };
      
    } catch (error) {
      console.error('Error deleting template:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: error.message || 'Failed to delete template'
        })
      };
    }
  }
  
  // Method not allowed
  return {
    statusCode: 405,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'Method not allowed' })
  };
}