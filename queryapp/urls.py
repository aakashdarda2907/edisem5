from django.urls import path
from . import views

app_name = "queryapp"

urlpatterns = [
    path("", views.index, name="index"),
    path("generate-query/", views.generate_query, name="generate_query"),
    path("revise-query/", views.revise_query, name="revise_query"),
    path("run-query/", views.run_query, name="run_query"),
]