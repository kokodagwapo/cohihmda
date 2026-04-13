-- Migration: Add Analytics knowledge category
-- Created: 2026-04-13
-- Database: management
--
-- Adds an "Analytics" category to global_knowledge_categories for data science
-- methods, statistical analysis frameworks, and visualization best practices.
-- This category is used to scope RAG retrieval for the Data Scientist agent
-- persona in the workbench and research lab.

INSERT INTO global_knowledge_categories (name, description, icon, sort_order) VALUES
  ('Analytics', 'Data science methods, statistical analysis, visualization best practices, and analytical frameworks for mortgage data', 'bar-chart-3', 9)
ON CONFLICT (name) DO NOTHING;
