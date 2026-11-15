from django.contrib.auth import views as auth_views
from django.urls import path

from . import views

app_name = 'crm'

urlpatterns = [
    path('', views.dashboard, name='dashboard'),
    path('login/', auth_views.LoginView.as_view(template_name='crm/login.html', redirect_authenticated_user=True),
         name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('employees/', views.employees_view, name='employees'),
    path('save/<str:kind>/', views.contact_save, name='save'),
    path('delete/<int:pk>/', views.contact_delete, name='delete'),
    path('call/<int:pk>/', views.call_log, name='call'),
    path('calls/<int:pk>/', views.call_history, name='calls'),
    path('import/<str:kind>/', views.import_view, name='import'),
    path('assign/<str:kind>/', views.assign_view, name='assign'),
    path('export/<str:kind>/', views.export_csv, name='export'),
    path('<slug:slug>/', views.contact_list, name='list'),
]
